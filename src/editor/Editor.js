import EventEmitter from "eventemitter3";
import {
  Matrix4,
  Vector2,
  Vector3,
  Quaternion,
  PropertyBinding,
  PerspectiveCamera,
  AudioListener,
  Raycaster,
  Clock,
  Scene
} from "three";
import { GLTFExporter } from "./gltf/GLTFExporter";
import { GLTFLoader } from "./gltf/GLTFLoader";
import History from "./History";
import Renderer from "./renderer/Renderer";
import ThumbnailRenderer from "./renderer/ThumbnailRenderer";

import SceneNode from "./nodes/SceneNode";
import FloorPlanNode from "./nodes/FloorPlanNode";

import LoadingCube from "./objects/LoadingCube";
import ErrorIcon from "./objects/ErrorIcon";
import TransformGizmo from "./objects/TransformGizmo";
import SpokeInfiniteGridHelper from "./helpers/SpokeInfiniteGridHelper";

import GLTFCache from "./caches/GLTFCache";
import TextureCache from "./caches/TextureCache";

import getDetachedObjectsRoots from "./utils/getDetachedObjectsRoots";
import { loadEnvironmentMap } from "./utils/EnvironmentMap";
import makeUniqueName from "./utils/makeUniqueName";
import { RethrownError, MultiError } from "./utils/errors";
import cloneObject3D from "./utils/cloneObject3D";
import isEmptyObject from "./utils/isEmptyObject";
import getIntersectingNode from "./utils/getIntersectingNode";
import { generateImageFileThumbnail, generateVideoFileThumbnail } from "./utils/thumbnails";
import resizeShadowCameraFrustum from "./utils/resizeShadowCameraFrustum";
import isInputSelected from "./utils/isInputSelected";
import { calculateGLTFPerformanceScores } from "./utils/performance";

import InputManager from "./controls/InputManager";
import FlyControls from "./controls/FlyControls";
import SpokeControls, { TransformMode } from "./controls/SpokeControls";
import PlayModeControls from "./controls/PlayModeControls";

import AddMultipleObjectsCommand from "./commands/AddMultipleObjectsCommand";
import AddObjectCommand from "./commands/AddObjectCommand";
import DeselectCommand from "./commands/DeselectCommand";
import DeselectMultipleCommand from "./commands/DeselectMultipleCommand";
import DuplicateCommand from "./commands/DuplicateCommand";
import DuplicateMultipleCommand from "./commands/DuplicateMultipleCommand";
import RemoveMultipleObjectsCommand from "./commands/RemoveMultipleObjectsCommand";
import RemoveObjectCommand from "./commands/RemoveObjectCommand";
import ReparentCommand from "./commands/ReparentCommand";
import ReparentMultipleCommand from "./commands/ReparentMultipleCommand";
import RotateAroundCommand from "./commands/RotateAroundCommand";
import RotateAroundMultipleCommand from "./commands/RotateAroundMultipleCommand";
import RotateOnAxisCommand from "./commands/RotateOnAxisCommand";
import RotateOnAxisMultipleCommand from "./commands/RotateOnAxisMultipleCommand";
import ScaleCommand from "./commands/ScaleCommand";
import ScaleMultipleCommand from "./commands/ScaleMultipleCommand";
import SelectCommand from "./commands/SelectCommand";
import SelectMultipleCommand from "./commands/SelectMultipleCommand";
import SetPositionCommand from "./commands/SetPositionCommand";
import SetPositionMultipleCommand from "./commands/SetPositionMultipleCommand";
import SetPropertiesCommand from "./commands/SetPropertiesCommand";
import SetPropertiesMultipleCommand from "./commands/SetPropertiesMultipleCommand";
import SetPropertyCommand from "./commands/SetPropertyCommand";
import SetPropertyMultipleCommand from "./commands/SetPropertyMultipleCommand";
import SetRotationCommand from "./commands/SetRotationCommand";
import SetRotationMultipleCommand from "./commands/SetRotationMultipleCommand";
import SetScaleCommand from "./commands/SetScaleCommand";
import SetScaleMultipleCommand from "./commands/SetScaleMultipleCommand";
import SetSelectionCommand from "./commands/SetSelectionCommand";
import TranslateCommand from "./commands/TranslateCommand";
import TranslateMultipleCommand from "./commands/TranslateMultipleCommand";
import GroupMultipleCommand from "./commands/GroupMultipleCommand";
import ReparentMultipleWithPositionCommand from "./commands/ReparentMultipleWithPositionCommand";
import LoadMaterialSlotCommand from "./commands/LoadMaterialSlotCommand";
import LoadMaterialSlotMultipleCommand from "./commands/LoadMaterialSlotMultipleCommand";

import GroupNode from "./nodes/GroupNode";
import ModelNode from "./nodes/ModelNode";
import VideoNode from "./nodes/VideoNode";
import ImageNode from "./nodes/ImageNode";
import AudioNode from "./nodes/AudioNode";
import LinkNode from "./nodes/LinkNode";
import AssetManifestSource from "../ui/assets/AssetManifestSource";

const tempMatrix1 = new Matrix4();
const tempMatrix2 = new Matrix4();
const tempMatrix3 = new Matrix4();
const tempMatrix4 = new Matrix4();
const tempMatrix5 = new Matrix4();
const tempQuaternion1 = new Quaternion();
const tempQuaternion2 = new Quaternion();
const tempVector1 = new Vector3();

export const TransformSpace = {
  World: "World",
  Local: "Local",
  LocalSelection: "LocalSelection" // The local space of the last selected object
  // TODO: Viewport, Cursor?
};

let resolveRenderer;
let rejectRenderer;
const rendererPromise = new Promise((resolve, reject) => {
  resolveRenderer = resolve;
  rejectRenderer = reject;
});

const removeObjectsRoots = [];

export default class Editor extends EventEmitter {
  constructor(api, settings = {}) {
    super();
    this.api = api;
    this.settings = settings;
    this.project = null;

    this.selected = [];
    this.selectedTransformRoots = [];

    this.history = new History();

    this.renderer = null;
    this.inputManager = null;
    this.spokeControls = null;
    this.flyControls = null;
    this.playModeControls = null;

    this.nodeTypes = new Set();
    this.nodeEditors = new Map();
    this.sources = [];
    this.defaultUploadSource = null;

    this.textureCache = new TextureCache();
    this.gltfCache = new GLTFCache();

    this.scene = new SceneNode(this);
    this.sceneModified = false;
    this.projectLoaded = false;

    this.camera = new PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.2, 8000);
    this.audioListener = new AudioListener();
    this.camera.add(this.audioListener);
    this.camera.layers.enable(1);
    this.camera.name = "Camera";

    this.helperScene = new Scene();

    this.grid = new SpokeInfiniteGridHelper();
    this.helperScene.add(this.grid);

    this.nodes = [this.scene];

    this.raycaster = new Raycaster();
    // Center at 0, 0
    this.centerScreenSpace = new Vector2();
    this.clock = new Clock();
    this.disableUpdate = false;
    this.initializing = false;
    this.initialized = false;
    this.sceneLoading = false;
  }

  registerNode(nodeConstructor, nodeEditor) {
    this.nodeTypes.add(nodeConstructor);
    this.nodeEditors.set(nodeConstructor, nodeEditor);
  }

  getNodeEditor(node) {
    return this.nodeEditors.get(node.constructor);
  }

  registerSource(source) {
    this.sources.push(source);

    if (source.uploadSource && !this.defaultUploadSource) {
      this.defaultUploadSource = source;
    }
  }

  async installAssetSource(manifestUrl) {
    const proxiedUrl = this.api.proxyUrl(new URL(manifestUrl, window.location).href);
    const res = await this.api.fetch(proxiedUrl);
    const json = await res.json();
    this.sources.push(new AssetManifestSource(this, json.name, manifestUrl));
    this.emit("settingsChanged");
  }

  getSource(sourceId) {
    return this.sources.find(source => source.id === sourceId);
  }

  setSource(sourceId) {
    this.emit("setSource", sourceId);
  }

  emit(eventName, ...args) {
    if (!this.sceneLoading) {
      super.emit(eventName, ...args);
    }
  }

  async init() {
    if (this.initialized) {
      return;
    }

    if (this.initializing) {
      return new Promise((resolve, reject) => {
        let cleanup = null;

        const onInitialize = () => {
          resolve();
          cleanup();
        };
        const onError = err => {
          reject(err);
          cleanup();
        };

        cleanup = () => {
          this.removeListener("initialized", onInitialize);
          this.removeListener("error", onError);
        };

        this.addListener("initialized", onInitialize);
        this.addListener("error", onError);
      });
    }

    this.initializing = true;

    const tasks = [rendererPromise, loadEnvironmentMap(), LoadingCube.load(), ErrorIcon.load(), TransformGizmo.load()];

    for (const NodeConstructor of this.nodeTypes) {
      tasks.push(NodeConstructor.load());
    }

    await Promise.all(tasks);

    this.inputManager = new InputManager(this.renderer.canvas);
    this.flyControls = new FlyControls(this.camera, this.inputManager);
    this.spokeControls = new SpokeControls(this.camera, this, this.inputManager, this.flyControls);
    this.playModeControls = new PlayModeControls(this.inputManager, this.spokeControls, this.flyControls);
    this.spokeControls.enable();

    window.addEventListener("copy", this.onCopy);
    window.addEventListener("paste", this.onPaste);

    this.rafId = requestAnimationFrame(this.update);

    this.initialized = true;

    this.emit("initialized");
  }

  onEmitSceneModified() {
    this.sceneModified = true;
    this.emit("sceneModified");
  }

  initializeRenderer(canvas) {
    try {
      this.renderer = new Renderer(this, canvas);
      this.thumbnailRenderer = new ThumbnailRenderer();
      resolveRenderer();
    } catch (error) {
      rejectRenderer(error);
    }
  }

  clearCaches() {
    this.textureCache.disposeAndClear();
    this.gltfCache.disposeAndClear();
  }

  async loadProject(projectFile) {
    this.removeListener("objectsChanged", this.onEmitSceneModified);
    this.removeListener("sceneGraphChanged", this.onEmitSceneModified);

    this.clearCaches();

    this.removeObject(this.scene);

    this.sceneLoading = true;
    this.disableUpdate = true;

    const [scene, errors] = await SceneNode.loadProject(this, projectFile);

    this.sceneLoading = false;
    this.disableUpdate = false;
    this.scene = scene;

    this.camera.position.set(0, 5, 10);
    this.camera.lookAt(new Vector3());
    this.scene.add(this.camera);

    this.spokeControls.center.set(0, 0, 0);
    this.spokeControls.onSceneSet(scene);

    this.renderer.onSceneSet();

    this.addObject(this.scene);

    this.deselectAll();

    this.history.clear();

    this.sceneModified = false;

    this.scene.traverse(node => {
      if (node.isNode) {
        node.onRendererChanged();
      }
    });

    if (errors.length === 0) {
      this.emit("projectLoaded");
    }

    this.emit("sceneGraphChanged");

    this.addListener("objectsChanged", this.onEmitSceneModified);
    this.addListener("sceneGraphChanged", this.onEmitSceneModified);

    if (errors.length > 0) {
      const error = new MultiError("Errors loading project", errors);
      this.emit("error", error);
      throw error;
    }

    return scene;
  }

  static DefaultExportOptions = {
    combineMeshes: true,
    removeUnusedObjects: true
  };

  async exportScene(signal, options = {}) {
    const { combineMeshes, removeUnusedObjects } = Object.assign({}, Editor.DefaultExportOptions, options);

    this.deselectAll(false);

    const scene = this.scene;

    const floorPlanNode = scene.findNodeByType(FloorPlanNode, false);

    if (floorPlanNode) {
      await floorPlanNode.generate(signal);
    }

    const clonedScene = cloneObject3D(scene, true);
    const animations = clonedScene.getAnimationClips();

    for (const clip of animations) {
      for (const track of clip.tracks) {
        const { nodeName: uuid } = PropertyBinding.parseTrackName(track.name);

        const object = clonedScene.getObjectByProperty("uuid", uuid);

        if (!object) {
          const originalSceneObject = scene.getObjectByProperty("uuid", uuid);

          if (originalSceneObject) {
            console.log(`Couldn't find object with uuid: "${uuid}" in cloned scene but was found in original scene!`);
          } else {
            console.log(`Couldn't find object with uuid: "${uuid}" in cloned or original scene!`);
          }
        }
      }
    }

    const exportContext = { animations };

    clonedScene.prepareForExport(exportContext);

    if (combineMeshes) {
      await clonedScene.combineMeshes();
    }

    if (removeUnusedObjects) {
      clonedScene.removeUnusedObjects();
    }

    const exporter = new GLTFExporter({
      mode: "glb",
      onlyVisible: false,
      includeCustomExtensions: true,
      animations
    });

    let chunks;

    try {
      chunks = await exporter.exportChunks(clonedScene);
    } catch (error) {
      throw new RethrownError(`Error exporting scene`, error);
    }

    const json = chunks.json;

    const nodeDefs = json.nodes;
    if (nodeDefs) {
      const uuidToIndexMap = {};

      for (let i = 0; i < nodeDefs.length; i++) {
        const nodeDef = nodeDefs[i];

        if (nodeDef.extras && nodeDef.extras.MOZ_spoke_uuid) {
          uuidToIndexMap[nodeDef.extras.MOZ_spoke_uuid] = i;
          delete nodeDef.extras.MOZ_spoke_uuid;

          if (isEmptyObject(nodeDef.extras)) {
            delete nodeDef.extras;
          }
        }
      }

      this.remapNodeRefsInComponents(json.nodes, nodeDefs, uuidToIndexMap);

      // Account for scenes that don't contain any geometry/materials.
      if (json.materials !== undefined) {
        this.remapNodeRefsInComponents(json.materials, nodeDefs, uuidToIndexMap);
      }
    }

    if (!json.extensions) {
      json.extensions = {};
    }

    // Increment this version when you are making a breaking change.
    // Document your changes here: https://github.com/mozilla/hubs/wiki/MOZ_hubs_components-Changelog
    json.extensions.MOZ_hubs_components = {
      version: 4
    };

    json.asset.generator = `Mozilla Spoke ${process.env.BUILD_VERSION}`;

    try {
      const glbBlob = await exporter.exportGLBBlob(chunks);

      let scores;

      if (options.scores) {
        scores = calculateGLTFPerformanceScores(scene, glbBlob, chunks);
      }

      return { glbBlob, chunks, scores };
    } catch (error) {
      throw new RethrownError("Error creating glb blob", error);
    }
  }

  remapNodeRefsInComponents(collection, nodeDefs, uuidToIndexMap) {
    for (const def of collection) {
      if (def.extensions && def.extensions.MOZ_hubs_components) {
        const components = def.extensions.MOZ_hubs_components;
        for (const componentName in components) {
          if (!Object.prototype.hasOwnProperty.call(components, componentName)) continue;

          const component = components[componentName];

          for (const propertyName in component) {
            if (!Object.prototype.hasOwnProperty.call(component, propertyName)) continue;

            const property = component[propertyName];

            if (
              property !== null &&
              typeof property === "object" &&
              Object.prototype.hasOwnProperty.call(property, "__gltfIndexForUUID")
            ) {
              component[propertyName] = {
                __mhc_link_type: "node",
                index: uuidToIndexMap[property.__gltfIndexForUUID]
              };
            }
          }
        }
      }
    }
  }

  getSpawnPosition(target) {
    return this.getScreenSpaceSpawnPosition(this.centerScreenSpace, target);
  }

  getCursorSpawnPosition(mousePos, target) {
    const rect = this.renderer.canvas.getBoundingClientRect();
    const position = new Vector2();
    position.x = ((mousePos.x - rect.left) / rect.width) * 2 - 1;
    position.y = ((mousePos.y - rect.top) / rect.height) * -2 + 1;
    return this.getScreenSpaceSpawnPosition(position, target);
  }

  getScreenSpaceSpawnPosition(screenSpacePosition, target) {
    this.raycaster.setFromCamera(screenSpacePosition, this.camera);
    const results = this.raycaster.intersectObject(this.scene, true);
    const result = getIntersectingNode(results, this.scene);

    if (result && result.distance < 1000) {
      target.copy(result.point);
    } else {
      this.raycaster.ray.at(20, target);
    }

    if (this.spokeControls.shouldSnap()) {
      const translationSnap = this.spokeControls.translationSnap;

      target.set(
        Math.round(target.x / translationSnap) * translationSnap,
        Math.round(target.y / translationSnap) * translationSnap,
        Math.round(target.z / translationSnap) * translationSnap
      );
    }
  }

  reparentToSceneAtCursorPosition(objects, mousePos) {
    const newPosition = new Vector3();
    this.getCursorSpawnPosition(mousePos, newPosition);
    this.history.execute(new ReparentMultipleWithPositionCommand(this, objects, this.scene, undefined, newPosition));
  }

  async takeScreenshot(width, height) {
    return this.renderer.takeScreenshot(width, height);
  }

  async generateFileThumbnail(file, width, height) {
    const url = URL.createObjectURL(file);

    let blob;

    if (file.name.toLowerCase().endsWith(".glb")) {
      const { scene } = await new GLTFLoader(url).loadGLTF();
      blob = await this.thumbnailRenderer.generateThumbnail(scene, width, height);
    } else if ([".png", ".jpg", ".jpeg", ".gif", ".webp"].some(ext => file.name.toLowerCase().endsWith(ext))) {
      blob = await generateImageFileThumbnail(file);
    } else if (file.name.toLowerCase().endsWith(".mp4")) {
      blob = await generateVideoFileThumbnail(file);
    }

    URL.revokeObjectURL(url);

    if (!blob) {
      throw new Error(`Unsupported file type for file: "${file.name}". File must be an image, video, or glb model.`);
    }

    return blob;
  }

  enterPlayMode() {
    this.playing = true;
    this.deselectAll();
    this.camera.layers.disable(1);
    this.playModeControls.enable();
    this.scene.traverse(node => {
      if (node.isNode) {
        node.onPlay();
      }
    });
    this.emit("playModeChanged");
  }

  leavePlayMode() {
    this.playing = false;
    this.camera.layers.enable(1);
    this.playModeControls.disable();
    this.scene.traverse(node => {
      if (node.isNode) {
        node.onPause();
      }
    });
    this.emit("playModeChanged");
  }

  update = () => {
    if (!this.disableUpdate) {
      const delta = this.clock.getDelta();
      const time = this.clock.getElapsedTime();
      this.scene.updateMatrixWorld();
      this.inputManager.update(delta, time);

      const enableShadows = this.renderer.renderMode.enableShadows;

      this.scene.traverse(node => {
        if (enableShadows && node.isDirectionalLight) {
          resizeShadowCameraFrustum(node, this.scene);
        }

        if (node.isNode) {
          node.onUpdate(delta, time);
        }
      });
      this.flyControls.update(delta);
      this.spokeControls.update(delta);

      this.renderer.update(delta, time);
      this.inputManager.reset();
    }

    this.rafId = requestAnimationFrame(this.update);
  };

  onResize = () => {
    this.inputManager.onResize();
    this.renderer.onResize();
    this.emit("resize");
  };

  revert(checkpointId) {
    this.history.revert(checkpointId);
  }

  undo() {
    this.history.undo();
  }

  redo() {
    this.history.redo();
  }

  select(object, useHistory = true, emitEvent = true, updateTransformRoots = true) {
    if (this.selected.indexOf(object) !== -1) {
      return this.selected;
    }

    if (emitEvent) {
      this.emit("beforeSelectionChanged");
    }

    if (useHistory) {
      return this.history.execute(new SelectCommand(this, object));
    }

    this.selected.push(object);

    if (object.isNode) {
      object.onSelect();
    }

    if (updateTransformRoots) {
      this.updateTransformRoots();
    }

    if (emitEvent) {
      this.emit("selectionChanged");
    }

    return this.selected;
  }

  selectMultiple(objects, useHistory = true, emitEvent = true, updateTransformRoots = true) {
    let selectionChanged = false;

    for (let i = 0; i < objects.length; i++) {
      if (this.selected.indexOf(objects[i]) === -1) {
        selectionChanged = true;
        break;
      }
    }

    if (!selectionChanged) {
      return this.selected;
    }

    if (emitEvent) {
      this.emit("beforeSelectionChanged");
    }

    if (useHistory) {
      return this.history.execute(new SelectMultipleCommand(this, objects));
    }

    for (let i = 0; i < objects.length; i++) {
      this.select(objects[i], false, false, false);
    }

    if (emitEvent) {
      this.emit("selectionChanged");
    }

    if (updateTransformRoots) {
      this.updateTransformRoots();
    }

    return this.selected;
  }

  selectAll(useHistory = true, emitEvent = true, updateTransformRoots = true) {
    return this.setSelection(this.nodes, useHistory, emitEvent, updateTransformRoots);
  }

  deselect(object, useHistory = true, emitEvent = true, updateTransformRoots = true) {
    const index = this.selected.indexOf(object);

    if (index === -1) {
      return this.selected;
    }

    if (emitEvent) {
      this.emit("beforeSelectionChanged");
    }

    if (useHistory) {
      return this.history.execute(new DeselectCommand(this, object));
    }

    this.selected.splice(index, 1);

    if (object.isNode) {
      object.onDeselect();
    }

    if (emitEvent) {
      this.emit("selectionChanged");
    }

    if (updateTransformRoots) {
      this.updateTransformRoots();
    }

    return this.selected;
  }

  deselectMultiple(objects, useHistory = true, emitEvent = true, updateTransformRoots = true) {
    let selectionChanged = false;

    for (let i = 0; i < objects.length; i++) {
      if (this.selected.indexOf(objects[i]) !== -1) {
        selectionChanged = true;
        break;
      }
    }

    if (!selectionChanged) {
      return this.selected;
    }

    if (emitEvent) {
      this.emit("beforeSelectionChanged");
    }

    if (useHistory) {
      return this.history.execute(new DeselectMultipleCommand(this, objects));
    }

    for (let i = 0; i < objects.length; i++) {
      this.deselect(objects[i], false, false, false);
    }

    if (emitEvent) {
      this.emit("selectionChanged");
    }

    if (updateTransformRoots) {
      this.updateTransformRoots();
    }

    return this.selected;
  }

  deselectAll(useHistory = true, emitEvent = true, updateTransformRoots = true) {
    return this.setSelection([], useHistory, emitEvent, updateTransformRoots);
  }

  toggleSelection(object, useHistory = true, emitEvent = true, updateTransformRoots = true) {
    if (this.selected.indexOf(object) !== -1) {
      return this.deselect(object, useHistory, emitEvent, updateTransformRoots);
    } else {
      return this.select(object, useHistory, emitEvent, updateTransformRoots);
    }
  }

  setSelection(objects, useHistory = true, emitEvent = true, updateTransformRoots = true) {
    if (objects.length === this.selected.length) {
      let equalSelection = true;

      for (let i = 0; i < objects.length; i++) {
        // TODO: Should selection order matter?
        if (this.selected[i] !== objects[i]) {
          equalSelection = false;
          break;
        }
      }

      if (equalSelection) {
        return this.selected;
      }
    }

    if (emitEvent) {
      this.emit("beforeSelectionChanged");
    }

    if (useHistory) {
      return this.history.execute(new SetSelectionCommand(this, objects));
    }

    const prevSelected = this.selected.slice(0);

    for (let i = this.selected.length - 1; i >= 0; i--) {
      const object = this.selected.pop();

      if (object.isNode && objects.indexOf(object) === -1) {
        object.onDeselect();
      }
    }

    for (let i = 0; i < objects.length; i++) {
      const object = objects[i];

      this.selected.push(object);

      if (object.isNode && prevSelected.indexOf(object) === -1) {
        object.onSelect();
      }
    }

    if (emitEvent) {
      this.emit("selectionChanged");
    }

    if (updateTransformRoots) {
      this.updateTransformRoots();
    }

    return this.selected;
  }

  addObject(object, parent, before, useHistory = true, emitEvent = true, selectObject = true, useUniqueName = false) {
    if (emitEvent && selectObject) {
      this.emit("beforeSelectionChanged");
    }

    // TODO: Add makeUniqueName option
    if (useHistory) {
      return this.history.execute(new AddObjectCommand(this, object, parent, before));
    }

    object.saveParent = true;

    if (parent !== undefined) {
      if (before !== undefined) {
        const index = parent.children.indexOf(before);

        if (index === -1) {
          throw new Error("addObject: before object not found");
        }

        parent.children.splice(index, 0, object);
        object.parent = parent;
      } else {
        parent.add(object);
      }
    } else if (object !== this.scene) {
      this.scene.add(object);
    }

    object.traverse(child => {
      if (child.isNode) {
        if (useUniqueName) {
          makeUniqueName(this.scene, child);
        }

        child.onAdd();
        this.nodes.push(child);
      }
    });

    object.updateMatrixWorld(true);

    if (selectObject) {
      this.setSelection([object], false, false);
    }

    if (emitEvent) {
      if (selectObject) {
        this.emit("selectionChanged");
      }

      this.emit("sceneGraphChanged");
    }

    return object;
  }

  addMultipleObjects(
    objects,
    parent,
    before,
    useHistory = true,
    emitEvent = true,
    selectObjects = true,
    useUniqueName = false
  ) {
    if (selectObjects && emitEvent) {
      this.emit("beforeSelectionChanged");
    }

    if (useHistory) {
      return this.history.execute(new AddMultipleObjectsCommand(this, objects, parent, before));
    }

    const rootObjects = getDetachedObjectsRoots(objects);

    for (let i = 0; i < rootObjects.length; i++) {
      this.addObject(rootObjects[i], parent, before, false, false, false, useUniqueName);
    }

    if (selectObjects) {
      this.setSelection(objects, false, false);
    }

    if (emitEvent) {
      if (selectObjects) {
        this.emit("selectionChanged");
      }

      this.emit("sceneGraphChanged");
    }

    return rootObjects;
  }

  _addMultipleObjectsWithParentsAndBefores(objects, parents, befores, oldNodes, emitEvent = true) {
    // Only use the roots of the objects array so that we don't add objects multiple times
    const rootObjects = getDetachedObjectsRoots(objects);

    // Add objects in reverse order so that befores are added first
    for (let i = rootObjects.length - 1; i >= 0; i--) {
      const rootObject = rootObjects[i];
      const rootIndex = objects.indexOf(rootObject);
      this.addObject(rootObject, parents[rootIndex], befores[rootIndex], false, false, false);
    }

    // Nodes are now out of order. Restore the old nodes list.
    this.nodes.length = 0;

    for (let i = 0; i < oldNodes.length; i++) {
      this.nodes.push(oldNodes[i]);
    }

    if (emitEvent) {
      this.emit("sceneGraphChanged");
    }
  }

  removeObject(object, useHistory = true, emitEvent = true, deselectObject = true) {
    if (object.parent === null) return null; // avoid deleting the camera or scene

    if (useHistory) {
      return this.history.execute(new RemoveObjectCommand(this, object));
    }

    object.traverse(child => {
      if (child.isNode) {
        child.onRemove();
        const index = this.nodes.indexOf(child);

        if (index === -1) {
          throw new Error(
            "removeObject: node not found. This is due to removing a node that is no longer in the scene."
          );
        }

        this.nodes.splice(index, 1);
      }
    });

    object.parent.remove(object);

    if (deselectObject) {
      this.deselect(object, false, emitEvent);
    }

    if (emitEvent) {
      this.emit("sceneGraphChanged");
    }

    return object;
  }

  removeMultipleObjects(objects, useHistory = true, emitEvent = true, deselectObjects = true) {
    this.getRootObjects(objects, removeObjectsRoots);

    if (useHistory) {
      return this.history.execute(new RemoveMultipleObjectsCommand(this, removeObjectsRoots));
    }

    for (let i = 0; i < removeObjectsRoots.length; i++) {
      this.removeObject(removeObjectsRoots[i], false, false, false);
    }

    if (deselectObjects) {
      this.deselectMultiple(objects, false, emitEvent);
    }

    if (emitEvent) {
      this.emit("sceneGraphChanged");
    }

    return removeObjectsRoots;
  }

  removeSelectedObjects(useHistory = true, emitEvent = true, deselectObjects = true) {
    return this.removeMultipleObjects(this.selected, useHistory, emitEvent, deselectObjects);
  }

  duplicate(object, parent, before, useHistory = true, emitEvent = true, selectObject = true) {
    if (emitEvent && selectObject) {
      this.emit("beforeSelectionChanged");
    }

    if (useHistory) {
      return this.history.execute(new DuplicateCommand(this, object, parent, before));
    }

    if (!object.constructor.canAddNode(this)) {
      return;
    }

    const clonedObject = object.clone();

    clonedObject.traverse(o => {
      if (o.isNode) {
        makeUniqueName(this.scene, o);
      }
    });

    this.addObject(clonedObject, parent || object.parent, before, false, false, false);

    if (selectObject) {
      this.setSelection([clonedObject], false, false, false);
    }

    this.updateTransformRoots();

    if (emitEvent) {
      if (selectObject) {
        this.emit("selectionChanged");
      }

      this.emit("sceneGraphChanged");
    }

    return clonedObject;
  }

  duplicateMultiple(objects, parent, before, useHistory = true, emitEvent = true, selectObjects = true) {
    if (emitEvent && selectObjects) {
      this.emit("beforeSelectionChanged");
    }

    if (useHistory) {
      return this.history.execute(new DuplicateMultipleCommand(this, objects, parent, before, selectObjects));
    }

    const validNodes = objects.filter(object => object.constructor.canAddNode(this));
    const roots = getDetachedObjectsRoots(validNodes);
    const duplicatedRoots = roots.map(object => object.clone());

    if (parent) {
      this.addMultipleObjects(duplicatedRoots, parent, before, false, false, false, true);
    } else {
      for (let i = 0; i < roots.length; i++) {
        this.addObject(duplicatedRoots[i], roots[i].parent, undefined, false, false, false, true);
      }
    }

    if (selectObjects) {
      this.setSelection(duplicatedRoots, false, false, false);
    }

    this.updateTransformRoots();

    if (emitEvent) {
      if (selectObjects) {
        this.emit("selectionChanged");
      }

      this.emit("sceneGraphChanged");
    }

    return duplicatedRoots;
  }

  duplicateSelected(parent, before, useHistory = true, emitEvent = true, selectObject = true) {
    this.duplicateMultiple(this.selected, parent, before, useHistory, emitEvent, selectObject);
  }

  reparent(object, newParent, newBefore, useHistory = true, emitEvent = true, selectObject = true) {
    if (!object.parent) {
      throw new Error(
        `${object.nodeName || object.type} "${
          object.name
        }" has no parent. Reparent only works on objects that are currently in the scene.`
      );
    }

    if (!newParent) {
      throw new Error("editor.reparent: newParent is undefined");
    }

    if (emitEvent && selectObject) {
      this.emit("beforeSelectionChanged");
    }

    if (useHistory) {
      return this.history.execute(new ReparentCommand(this, object, newParent, newBefore));
    }

    if (newParent !== object.parent) {
      // Maintain world position when reparenting.
      newParent.updateMatrixWorld();

      tempMatrix1.getInverse(newParent.matrixWorld);

      object.parent.updateMatrixWorld();
      tempMatrix1.multiply(object.parent.matrixWorld);

      object.applyMatrix(tempMatrix1);

      object.updateWorldMatrix(false, false);
    }

    const objectIndex = object.parent.children.indexOf(object);
    object.parent.children.splice(objectIndex, 1);

    if (newBefore) {
      const newObjectIndex = newParent.children.indexOf(newBefore);
      newParent.children.splice(newObjectIndex, 0, object);
    } else {
      newParent.children.push(object);
    }

    object.parent = newParent;

    object.updateMatrixWorld(true);

    if (selectObject) {
      this.setSelection([object], false, false, false);
    }

    this.updateTransformRoots();

    if (emitEvent) {
      if (selectObject) {
        this.emit("selectionChanged");
      }

      this.emit("sceneGraphChanged");
    }

    return object;
  }

  reparentMultiple(objects, newParent, newBefore, useHistory = true, emitEvent = true, selectObjects = true) {
    if (emitEvent && selectObjects) {
      this.emit("beforeSelectionChanged");
    }

    if (useHistory) {
      return this.history.execute(new ReparentMultipleCommand(this, objects, newParent, newBefore));
    }

    for (let i = 0; i < objects.length; i++) {
      this.reparent(objects[i], newParent, newBefore, false, false, false);
    }

    if (selectObjects) {
      this.setSelection(objects, false, false, false);
    }

    this.updateTransformRoots();

    if (emitEvent) {
      if (selectObjects) {
        this.emit("selectionChanged");
      }

      this.emit("sceneGraphChanged");
    }

    return objects;
  }

  reparentSelected(newParent, newBefore, useHistory = true, emitEvent = true, selectObjects = true) {
    return this.reparentMultiple(this.selected, newParent, newBefore, useHistory, emitEvent, selectObjects);
  }

  groupMultiple(objects, groupParent, groupBefore, useHistory = true, emitEvent = true, selectObject = true) {
    if (emitEvent && selectObject) {
      this.emit("beforeSelectionChanged");
    }

    if (useHistory) {
      return this.history.execute(new GroupMultipleCommand(this, objects, groupParent, groupBefore));
    }

    const groupNode = this.addObject(new GroupNode(this), groupParent, groupBefore, false, false, false);

    for (let i = 0; i < objects.length; i++) {
      this.reparent(objects[i], groupNode, undefined, false, false, false);
    }

    if (selectObject) {
      this.setSelection([groupNode], false, false, false);
    }

    this.updateTransformRoots();

    if (emitEvent) {
      if (selectObject) {
        this.emit("selectionChanged");
      }

      this.emit("sceneGraphChanged");
    }

    return groupNode;
  }

  groupSelected(groupParent, groupBefore, useHistory = true, emitEvent = true, selectObject = true) {
    return this.groupMultiple(
      this.selectedTransformRoots,
      groupParent,
      groupBefore,
      useHistory,
      emitEvent,
      selectObject
    );
  }

  setPosition(object, position, space = TransformSpace.Local, useHistory = true, emitEvent = true) {
    if (useHistory) {
      return this.history.execute(new SetPositionCommand(this, object, position, space));
    }

    if (space === TransformSpace.Local) {
      object.position.copy(position);
    } else {
      object.updateMatrixWorld(); // Update parent world matrices

      tempVector1.copy(position);

      let spaceMatrix;

      if (space === TransformSpace.World) {
        spaceMatrix = object.parent.matrixWorld;
      } else if (space === TransformSpace.LocalSelection) {
        if (this.selected.length > 0) {
          const lastSelectedObject = this.selected[this.selected.length - 1];
          lastSelectedObject.updateMatrixWorld();
          spaceMatrix = lastSelectedObject.parent.matrixWorld;
        } else {
          spaceMatrix = tempMatrix1.identity();
        }
      } else {
        spaceMatrix = space;
      }

      tempMatrix1.getInverse(spaceMatrix);
      tempVector1.applyMatrix4(tempMatrix1);
      object.position.copy(tempVector1);
    }

    object.updateMatrixWorld(true);

    object.onChange("position");

    if (emitEvent) {
      this.emit("objectsChanged", [object], "position");
    }

    return object;
  }

  setPositionMultiple(objects, position, space = TransformSpace.Local, useHistory = true, emitEvent = true) {
    if (useHistory) {
      return this.history.execute(new SetPositionMultipleCommand(this, objects, position, space));
    }

    if (space === TransformSpace.LocalSelection) {
      if (this.selected.length > 0) {
        const lastSelectedObject = this.selected[this.selected.length - 1];
        lastSelectedObject.updateMatrixWorld();
        space = lastSelectedObject.parent.matrixWorld;
      } else {
        space = tempMatrix1.identity();
      }
    }

    for (let i = 0; i < objects.length; i++) {
      this.setPosition(objects[i], position, space, false, false);
    }

    if (emitEvent) {
      this.emit("objectsChanged", objects, "position");
    }

    return objects;
  }

  setPositionSelected(position, space = TransformSpace.Local, useHistory = true, emitEvent = true) {
    return this.setPositionMultiple(this.selectedTransformRoots, position, space, useHistory, emitEvent);
  }

  translate(object, translation, space = TransformSpace.Local, useHistory = true, emitEvent = true) {
    if (useHistory) {
      return this.history.execute(new TranslateCommand(this, object, translation, space));
    }

    if (space === TransformSpace.Local) {
      object.position.add(translation);
    } else {
      object.updateMatrixWorld(); // Update parent world matrices
      tempVector1.setFromMatrixPosition(object.matrixWorld);
      tempVector1.add(translation);

      let spaceMatrix;

      if (space === TransformSpace.World) {
        spaceMatrix = object.parent.matrixWorld;
      } else if (space === TransformSpace.LocalSelection) {
        if (this.selected.length > 0) {
          const lastSelectedObject = this.selected[this.selected.length - 1];
          lastSelectedObject.updateMatrixWorld();
          spaceMatrix = lastSelectedObject.parent.matrixWorld;
        } else {
          spaceMatrix = tempMatrix1.identity();
        }
      } else {
        spaceMatrix = space;
      }

      tempMatrix1.getInverse(spaceMatrix);
      tempVector1.applyMatrix4(tempMatrix1);
      object.position.copy(tempVector1);
    }

    object.updateMatrixWorld(true);

    object.onChange("position");

    if (emitEvent) {
      this.emit("objectsChanged", [object], "position");
    }

    return object;
  }

  translateMultiple(objects, translation, space = TransformSpace.Local, useHistory = true, emitEvent = true) {
    if (useHistory) {
      return this.history.execute(new TranslateMultipleCommand(this, objects, translation, space));
    }

    if (space === TransformSpace.LocalSelection) {
      if (this.selected.length > 0) {
        const lastSelectedObject = this.selected[this.selected.length - 1];
        lastSelectedObject.updateMatrixWorld();
        space = lastSelectedObject.parent.matrixWorld;
      } else {
        space = tempMatrix1.identity();
      }
    }

    for (let i = 0; i < objects.length; i++) {
      this.translate(objects[i], translation, space, false, false);
    }

    if (emitEvent) {
      this.emit("objectsChanged", objects, "position");
    }

    return objects;
  }

  translateSelected(translation, space = TransformSpace.Local, useHistory = true, emitEvent = true) {
    return this.translateMultiple(this.selectedTransformRoots, translation, space, useHistory, emitEvent);
  }

  setRotation(object, rotation, space = TransformSpace.Local, useHistory = true, emitEvent = true) {
    if (useHistory) {
      return this.history.execute(new SetRotationCommand(this, object, rotation, space));
    }

    if (space === TransformSpace.Local) {
      object.rotation.copy(rotation);
    } else {
      object.updateMatrixWorld(); // Update parent world matrices

      let spaceMatrix;

      if (space === TransformSpace.World) {
        spaceMatrix = object.parent.matrixWorld;
      } else if (space === TransformSpace.LocalSelection) {
        if (this.selected.length > 0) {
          const lastSelectedObject = this.selected[this.selected.length - 1];
          lastSelectedObject.updateMatrixWorld();
          spaceMatrix = lastSelectedObject.parent.matrixWorld;
        } else {
          spaceMatrix = tempMatrix1.identity();
        }
      } else {
        spaceMatrix = space;
      }

      const newWorldQuaternion = tempQuaternion1.setFromEuler(rotation);
      const inverseParentWorldQuaternion = tempQuaternion2.setFromRotationMatrix(spaceMatrix).inverse();
      const newLocalQuaternion = inverseParentWorldQuaternion.multiply(newWorldQuaternion);
      object.quaternion.copy(newLocalQuaternion);
    }

    object.updateMatrixWorld(true);

    object.onChange("rotation");

    if (emitEvent) {
      this.emit("objectsChanged", [object], "rotation");
    }

    return object;
  }

  setRotationMultiple(objects, rotation, space = TransformSpace.Local, useHistory = true, emitEvent = true) {
    if (useHistory) {
      return this.history.execute(new SetRotationMultipleCommand(this, objects, rotation, space));
    }

    if (space === TransformSpace.LocalSelection) {
      if (this.selected.length > 0) {
        const lastSelectedObject = this.selected[this.selected.length - 1];
        lastSelectedObject.updateMatrixWorld();
        space = lastSelectedObject.parent.matrixWorld;
      } else {
        space = tempMatrix1.identity();
      }
    }

    for (let i = 0; i < objects.length; i++) {
      this.setRotation(objects[i], rotation, space, false, false);
    }

    if (emitEvent) {
      this.emit("objectsChanged", objects, "rotation");
    }

    return objects;
  }

  setRotationSelected(rotation, space = TransformSpace.Local, useHistory = true, emitEvent = true) {
    return this.setRotationMultiple(this.selectedTransformRoots, rotation, space, useHistory, emitEvent);
  }

  rotateOnAxis(object, axis, angle, space = TransformSpace.Local, useHistory = true, emitEvent = true) {
    if (useHistory) {
      return this.history.execute(new RotateOnAxisCommand(this, object, axis, angle, space));
    }

    if (space === TransformSpace.Local) {
      object.rotateOnAxis(axis, angle);
    } else if (space === TransformSpace.World) {
      object.rotateOnWorldAxis(axis, angle);
    } else {
      object.updateMatrixWorld(); // Update parent world matrices

      let spaceMatrix;

      if (space === TransformSpace.LocalSelection) {
        if (this.selected.length > 0) {
          const lastSelectedObject = this.selected[this.selected.length - 1];
          lastSelectedObject.updateMatrixWorld();
          space = lastSelectedObject.parent.matrixWorld;
        } else {
          space = tempMatrix1.identity();
        }
      } else {
        spaceMatrix = space;
      }

      tempMatrix1.getInverse(spaceMatrix);
      tempVector1.copy(axis).applyMatrix4(tempMatrix1);

      object.rotateOnAxis(tempVector1, angle);
    }

    object.updateMatrixWorld(true);

    object.onChange("position");

    if (emitEvent) {
      this.emit("objectsChanged", [object], "position");
    }

    return object;
  }

  rotateOnAxisMultiple(objects, axis, angle, space = TransformSpace.Local, useHistory = true, emitEvent = true) {
    if (useHistory) {
      return this.history.execute(new RotateOnAxisMultipleCommand(this, objects, axis, angle, space));
    }

    if (space === TransformSpace.LocalSelection) {
      if (this.selected.length > 0) {
        const lastSelectedObject = this.selected[this.selected.length - 1];
        lastSelectedObject.updateMatrixWorld();
        space = lastSelectedObject.parent.matrixWorld;
      } else {
        space = tempMatrix1.identity();
      }
    }

    for (let i = 0; i < objects.length; i++) {
      this.rotateOnAxis(objects[i], axis, angle, space, false, false);
    }

    if (emitEvent) {
      this.emit("objectsChanged", objects, "rotation");
    }

    return objects;
  }

  rotateOnAxisSelected(axis, angle, space = TransformSpace.Local, useHistory = true, emitEvent = true) {
    return this.rotateOnAxisMultiple(this.selectedTransformRoots, axis, angle, space, useHistory, emitEvent);
  }

  rotateAround(object, pivot, axis, angle, useHistory = true, emitEvent = true) {
    if (useHistory) {
      return this.history.execute(new RotateAroundCommand(this, object, pivot, axis, angle));
    }

    object.updateMatrixWorld();

    const matrixWorld = tempMatrix1.copy(object.matrixWorld);
    const inverseParentMatrixWorld = tempMatrix2.getInverse(object.parent.matrixWorld);

    const pivotToOriginMatrix = tempMatrix3.makeTranslation(-pivot.x, -pivot.y, -pivot.z);
    const originToPivotMatrix = tempMatrix4.makeTranslation(pivot.x, pivot.y, pivot.z);

    const rotationMatrix = tempMatrix5.makeRotationAxis(axis, angle);

    matrixWorld
      .premultiply(pivotToOriginMatrix)
      .premultiply(rotationMatrix)
      .premultiply(originToPivotMatrix)
      .premultiply(inverseParentMatrixWorld)
      .decompose(object.position, object.quaternion, object.scale);

    object.updateMatrixWorld();

    if (emitEvent) {
      this.emit("objectsChanged", [object], "matrix");
    }

    return object;
  }

  rotateAroundMultiple(objects, pivot, axis, angle, useHistory = true, emitEvent = true) {
    if (useHistory) {
      return this.history.execute(new RotateAroundMultipleCommand(this, objects, pivot, axis, angle));
    }

    for (let i = 0; i < objects.length; i++) {
      this.rotateAround(objects[i], pivot, axis, angle, false, false);
    }

    if (emitEvent) {
      this.emit("objectsChanged", objects, "matrix");
    }

    return objects;
  }

  rotateAroundSelected(pivot, axis, angle, useHistory = true, emitEvent = true) {
    return this.rotateAroundMultiple(this.selectedTransformRoots, pivot, axis, angle, useHistory, emitEvent);
  }

  scale(object, scale, space = TransformSpace.Local, useHistory = true, emitEvent = true) {
    if (useHistory) {
      return this.history.execute(new ScaleCommand(this, object, scale, space));
    }

    if (space === TransformSpace.World && (scale.x !== scale.y || scale.x !== scale.z || scale.y !== scale.z)) {
      console.warn("Scaling an object in world space with a non-uniform scale is not supported");
    }

    object.scale.multiply(scale);

    object.updateMatrixWorld(true);

    object.onChange("scale");

    if (emitEvent) {
      this.emit("objectsChanged", [object], "scale");
    }

    return object;
  }

  scaleMultiple(objects, scale, space = TransformSpace.Local, useHistory = true, emitEvent = true) {
    if (useHistory) {
      return this.history.execute(new ScaleMultipleCommand(this, objects, scale, space));
    }

    for (let i = 0; i < objects.length; i++) {
      this.scale(objects[i], scale, space, false, false);
    }

    if (emitEvent) {
      this.emit("objectsChanged", objects, "scale");
    }

    return objects;
  }

  scaleSelected(scale, space = TransformSpace.Local, useHistory = true, emitEvent = true) {
    return this.scaleMultiple(this.selectedTransformRoots, scale, space, useHistory, emitEvent);
  }

  setScale(object, scale, space = TransformSpace.Local, useHistory = true, emitEvent = true) {
    if (useHistory) {
      return this.history.execute(new SetScaleCommand(this, object, scale, space));
    }

    if (space === TransformSpace.Local) {
      tempVector1.set(
        scale.x === 0 ? Number.EPSILON : scale.x,
        scale.y === 0 ? Number.EPSILON : scale.y,
        scale.z === 0 ? Number.EPSILON : scale.z
      );

      object.scale.copy(tempVector1);
    } else {
      object.updateMatrixWorld(); // Update parent world matrices

      tempVector1.copy(scale);

      let spaceMatrix;

      if (space === TransformSpace.World) {
        spaceMatrix = object.parent.matrixWorld;
      } else if (space === TransformSpace.LocalSelection) {
        if (this.selected.length > 0) {
          const lastSelectedObject = this.selected[this.selected.length - 1];
          lastSelectedObject.updateMatrixWorld();
          spaceMatrix = lastSelectedObject.parent.matrixWorld;
        } else {
          spaceMatrix = tempMatrix1.identity();
        }
      } else {
        spaceMatrix = space;
      }

      tempMatrix1.getInverse(spaceMatrix);
      tempVector1.applyMatrix4(tempMatrix1);

      tempVector1.set(
        tempVector1.x === 0 ? Number.EPSILON : tempVector1.x,
        tempVector1.y === 0 ? Number.EPSILON : tempVector1.y,
        tempVector1.z === 0 ? Number.EPSILON : tempVector1.z
      );

      object.scale.copy(tempVector1);
    }

    object.updateMatrixWorld(true);

    object.onChange("scale");

    if (emitEvent) {
      this.emit("objectsChanged", [object], "scale");
    }

    return object;
  }

  setScaleMultiple(objects, scale, space = TransformSpace.Local, useHistory = true, emitEvent = true) {
    if (useHistory) {
      return this.history.execute(new SetScaleMultipleCommand(this, objects, scale, space));
    }

    if (space === TransformSpace.LocalSelection) {
      if (this.selected.length > 0) {
        const lastSelectedObject = this.selected[this.selected.length - 1];
        lastSelectedObject.updateMatrixWorld();
        space = lastSelectedObject.parent.matrixWorld;
      } else {
        space = tempMatrix1.identity();
      }
    }

    for (let i = 0; i < objects.length; i++) {
      this.setScale(objects[i], scale, space, false, false);
    }

    if (emitEvent) {
      this.emit("objectsChanged", objects, "scale");
    }

    return objects;
  }

  setScaleSelected(scale, space = TransformSpace.Local, useHistory = true, emitEvent = true) {
    return this.setScaleMultiple(this.selectedTransformRoots, scale, space, useHistory, emitEvent);
  }

  setProperty(object, propertyName, value, useHistory = true, emitEvent = true, disableCopy = false) {
    if (useHistory) {
      return this.history.execute(new SetPropertyCommand(this, object, propertyName, value, disableCopy));
    }

    if (value && value.copy && !disableCopy) {
      object[propertyName].copy(value);
    } else {
      object[propertyName] = value;
    }

    if (object.onChange) {
      object.onChange(propertyName);
    }

    if (emitEvent) {
      this.emit("objectsChanged", [object], propertyName);
    }

    return object;
  }

  setPropertyMultiple(objects, propertyName, value, useHistory = true, emitEvent = true) {
    if (useHistory) {
      return this.history.execute(new SetPropertyMultipleCommand(this, objects, propertyName, value));
    }

    for (let i = 0; i < objects.length; i++) {
      this.setProperty(objects[i], propertyName, value, false, false);
    }

    if (emitEvent) {
      this.emit("objectsChanged", objects, propertyName);
    }

    return objects;
  }

  setPropertySelected(propertyName, value, useHistory = true, emitEvent = true) {
    return this.setPropertyMultiple(this.selected, propertyName, value, useHistory, emitEvent);
  }

  setProperties(object, properties, useHistory = true, emitEvent = true) {
    if (useHistory) {
      return this.history.execute(new SetPropertiesCommand(this, object, properties));
    }

    for (const propertyName in properties) {
      if (!Object.prototype.hasOwnProperty.call(properties, propertyName)) continue;

      const value = properties[propertyName];

      if (value && value.copy) {
        object[propertyName].copy(value);
      } else {
        object[propertyName] = value;
      }
    }

    object.onChange();

    if (emitEvent) {
      this.emit("objectsChanged", [object]);
    }

    return object;
  }

  setPropertiesMultiple(objects, properties, useHistory = true, emitEvent = true) {
    if (useHistory) {
      return this.history.execute(new SetPropertiesMultipleCommand(this, objects, properties));
    }

    for (let i = 0; i < objects.length; i++) {
      this.setProperties(objects[i], properties, false, false);
    }

    if (emitEvent) {
      this.emit("objectsChanged", objects);
    }

    return objects;
  }

  setPropertiesSelected(properties, useHistory = true, emitEvent = true) {
    return this.setPropertiesMultiple(this.selected, properties, useHistory, emitEvent);
  }

  loadMaterialSlot(object, subPieceId, materialSlotId, materialId, useHistory = true, emitEvent = true) {
    if (useHistory) {
      return this.history.execute(new LoadMaterialSlotCommand(this, object, subPieceId, materialSlotId, materialId));
    }

    object.loadMaterialSlot(subPieceId, materialSlotId, materialId).catch(console.error);

    if (object.onChange) {
      object.onChange("materialSlot");
    }

    if (emitEvent) {
      this.emit("objectsChanged", [object], "materialSlot");
    }

    return object;
  }

  loadMaterialSlotMultiple(objects, subPieceId, materialSlotId, materialId, useHistory = true, emitEvent = true) {
    if (useHistory) {
      return this.history.execute(
        new LoadMaterialSlotMultipleCommand(this, objects, subPieceId, materialSlotId, materialId)
      );
    }

    for (const object of objects) {
      object.loadMaterialSlot(subPieceId, materialSlotId, materialId).catch(console.error);

      if (object.onChange) {
        object.onChange("materialSlot");
      }
    }

    if (emitEvent) {
      this.emit("objectsChanged", objects, "materialSlot");
    }

    return objects;
  }

  loadMaterialSlotSelected(subPieceId, materialSlotId, materialId, useHistory = true, emitEvent = true) {
    return this.loadMaterialSlotMultiple(this.selected, subPieceId, materialSlotId, materialId, useHistory, emitEvent);
  }

  getRootObjects(objects, target = [], filterUnremovable = true, filterUntransformable = false) {
    target.length = 0;

    // Recursively find the nodes in the tree with the lowest depth
    const traverse = curObject => {
      if (
        objects.indexOf(curObject) !== -1 &&
        !(filterUnremovable && !curObject.parent) &&
        !(filterUntransformable && curObject.disableTransform)
      ) {
        target.push(curObject);
        return;
      }

      const children = curObject.children;

      for (let i = 0; i < children.length; i++) {
        const child = children[i];

        if (child.isNode) {
          traverse(child);
        }
      }
    };

    traverse(this.scene);

    return target;
  }

  getTransformRoots(objects, target = []) {
    return this.getRootObjects(objects, target, true, true);
  }

  updateTransformRoots() {
    this.getTransformRoots(this.selected, this.selectedTransformRoots);
  }

  onCopy = event => {
    if (isInputSelected()) {
      return;
    }

    event.preventDefault();

    // TODO: Prevent copying objects with a disabled transform
    if (this.selected.length > 0) {
      event.clipboardData.setData(
        "application/vnd.spoke.nodes",
        JSON.stringify({ nodeUUIDs: this.selected.map(node => node.uuid) })
      );
    }
  };

  onPaste = event => {
    if (isInputSelected()) {
      return;
    }

    event.preventDefault();

    let data;

    if ((data = event.clipboardData.getData("application/vnd.spoke.nodes")) !== "") {
      const { nodeUUIDs } = JSON.parse(data);

      if (!Array.isArray(nodeUUIDs)) {
        return;
      }

      const nodes = nodeUUIDs.map(uuid => this.scene.getObjectByUUID(uuid)).filter(uuid => uuid !== undefined);

      this.duplicateMultiple(nodes);
    } else if ((data = event.clipboardData.getData("text")) !== "") {
      try {
        const url = new URL(data);
        this.addMedia(url.href).catch(error => this.emit("error", error));
      } catch (e) {
        console.warn("Clipboard contents did not contain a valid url");
      }
    }
  };

  async addMedia(url, parent, before) {
    let contentType = "";

    const { hostname } = new URL(url);

    try {
      contentType = (await this.api.getContentType(url)) || "";
    } catch (error) {
      console.warn(`Couldn't fetch content type for url ${url}. Using LinkNode instead.`);
    }

    let node;

    if (contentType.startsWith("model/gltf")) {
      node = new ModelNode(this);
      this.getSpawnPosition(node.position);
      this.addObject(node, parent, before);
      node.initialScale = "fit";
      await node.load(url);
    } else if (contentType.startsWith("video/") || hostname === "www.twitch.tv") {
      node = new VideoNode(this);
      this.getSpawnPosition(node.position);
      this.addObject(node, parent, before);
      await node.load(url);
    } else if (contentType.startsWith("image/")) {
      node = new ImageNode(this);
      this.getSpawnPosition(node.position);
      this.addObject(node, parent, before);
      await node.load(url);
    } else if (contentType.startsWith("audio/")) {
      node = new AudioNode(this);
      this.getSpawnPosition(node.position);
      this.addObject(node, parent, before);
      await node.load(url);
    } else {
      node = new LinkNode(this);
      this.getSpawnPosition(node.position);
      node.href = url;
      this.addObject(node, parent, before);
    }

    return node;
  }

  spawnGrabbedObject(object) {
    if (this.spokeControls.transformMode === TransformMode.Placement) {
      this.removeSelectedObjects();
    }

    if (!object.disableTransform) {
      this.getSpawnPosition(object.position);
    }

    this.addObject(object);

    if (!object.disableTransform) {
      this.spokeControls.setTransformMode(TransformMode.Placement, object.useMultiplePlacementMode);
    }
  }

  incrementGridHeight() {
    this.setGridHeight(this.grid.position.y + 1.5);
  }

  decrementGridHeight() {
    this.setGridHeight(this.grid.position.y - 1.5);
  }

  setGridHeight(value) {
    this.grid.position.y = value;
    this.emit("gridHeightChanged", value);
  }

  toggleGridVisible() {
    this.grid.visible = !this.grid.visible;
    this.emit("gridVisibilityChanged", this.grid.visible);
  }

  dispose() {
    this.clearCaches();

    if (this.renderer) {
      this.renderer.dispose();
    }
  }
}
