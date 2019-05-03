import EditorNodeMixin from "./EditorNodeMixin";
import THREE from "../../vendor/three";
import FloorPlan from "../objects/FloorPlan";
import ModelNode from "./ModelNode";
import GroundPlaneNode from "./GroundPlaneNode";
import BoxColliderNode from "./BoxColliderNode";
import mergeMeshGeometries from "../utils/mergeMeshGeometries";
import RecastClient from "../recast/RecastClient";

const recastClient = new RecastClient();

export default class FloorPlanNode extends EditorNodeMixin(FloorPlan) {
  static nodeName = "Floor Plan";

  static legacyComponentName = "floor-plan";

  static disableTransform = true;

  static canAddNode(editor) {
    return editor.scene.findNodeByType(FloorPlanNode) === null;
  }

  static async deserialize(editor, json) {
    const node = await super.deserialize(editor, json);

    const {
      autoCellSize,
      cellSize,
      cellHeight,
      agentHeight,
      agentRadius,
      agentMaxClimb,
      agentMaxSlope,
      regionMinSize
    } = json.components.find(c => c.name === "floor-plan").props;

    node.autoCellSize = autoCellSize;
    node.cellSize = cellSize;
    node.cellHeight = cellHeight;
    node.agentHeight = agentHeight;
    node.agentRadius = agentRadius;
    node.agentMaxClimb = agentMaxClimb;
    node.agentMaxSlope = agentMaxSlope;
    node.regionMinSize = regionMinSize;

    return node;
  }

  constructor(editor) {
    super(editor);
    this.autoCellSize = true;
    this.cellSize = 0.166;
    this.cellHeight = 0.1;
    this.agentHeight = 1.7;
    this.agentRadius = 0.5;
    this.agentMaxClimb = 0.3;
    this.agentMaxSlope = 45;
    this.regionMinSize = 4;
  }

  onSelect() {
    if (this.navMesh) {
      this.navMesh.visible = true;
    }
  }

  onDeselect() {
    if (this.navMesh) {
      this.navMesh.visible = false;
    }
  }

  async generateNavGeometry(geometry, generateHeightfield, signal) {
    if (!geometry.attributes.position || geometry.attributes.position.count === 0) {
      const emptyGeometry = new THREE.BufferGeometry();
      emptyGeometry.setIndex([]);
      emptyGeometry.addAttribute("position", new THREE.Float32BufferAttribute([], 3));
      return emptyGeometry;
    }

    const box = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
    const size = new THREE.Vector3();
    box.getSize(size);
    if (Math.max(size.x, size.y, size.z) > 2000) {
      throw new Error(
        `Scene is too large (${size.x.toFixed(3)} x ${size.y.toFixed(3)} x ${size.z.toFixed(3)}) ` +
          `to generate a floor plan.\n` +
          `You can un-check the "walkable" checkbox on models to exclude them from the floor plan.`
      );
    }

    const positions = geometry.attributes.position.array;
    const indices = new Int32Array(positions.length / 3);
    for (let i = 0; i < indices.length; i++) {
      indices[i] = i;
    }

    const area = size.x * size.z;

    // Tuned to produce cell sizes from ~0.5 to ~1.5 for areas from ~200 to ~350,000.
    const cellSize = this.autoCellSize ? Math.pow(area, 1 / 3) / 50 : this.cellSize;

    return recastClient.buildNavMesh(
      positions,
      indices,
      {
        cellSize,
        cellHeight: this.cellHeight,
        agentHeight: this.agentHeight,
        agentRadius: this.agentRadius,
        agentMaxClimb: this.agentMaxClimb,
        agentMaxSlope: this.agentMaxSlope,
        regionMinSize: this.regionMinSize
      },
      generateHeightfield,
      signal
    );
  }

  async generate(signal) {
    const collidableMeshes = [];
    const walkableMeshes = [];

    const groundPlaneNode = this.editor.scene.findNodeByType(GroundPlaneNode);

    if (groundPlaneNode && groundPlaneNode.walkable) {
      walkableMeshes.push(groundPlaneNode.walkableMesh);
    }

    const modelNodes = this.editor.scene.getNodesByType(ModelNode);

    for (const node of modelNodes) {
      const model = node.model;

      if (!model || !(node.collidable || node.walkable)) {
        continue;
      }

      model.traverse(child => {
        if (child.isMesh) {
          if (node.collidable) {
            collidableMeshes.push(child);
          }

          if (node.walkable) {
            walkableMeshes.push(child);
          }
        }
      });
    }

    const boxColliderNodes = this.editor.scene.getNodesByType(BoxColliderNode);

    for (const node of boxColliderNodes) {
      if (node.walkable) {
        const helperMesh = node.helper.object;
        const boxColliderMesh = new THREE.Mesh(helperMesh.geometry, new THREE.MeshBasicMaterial());
        boxColliderMesh.applyMatrix(node.matrixWorld);
        boxColliderMesh.updateMatrixWorld();
        walkableMeshes.push(boxColliderMesh);
      }
    }

    const walkableGeometry = mergeMeshGeometries(walkableMeshes);
    const { navmesh } = await this.generateNavGeometry(walkableGeometry, false, signal);
    const navMesh = new THREE.Mesh(navmesh, new THREE.MeshBasicMaterial({ color: 0x0000ff }));

    if (this.editor.selected !== this) {
      navMesh.visible = false;
    }

    this.setNavMesh(navMesh);

    const heightfieldGeometry = mergeMeshGeometries(collidableMeshes);
    const { heightfield } = await this.generateNavGeometry(heightfieldGeometry, true, signal);
    this.heightfield = heightfield;

    return this;
  }

  copy(source, recursive) {
    super.copy(source, recursive);
    this.autoCellSize = source.autoCellSize;
    this.cellSize = source.cellSize;
    this.cellHeight = source.cellHeight;
    this.agentHeight = source.agentHeight;
    this.agentRadius = source.agentRadius;
    this.agentMaxClimb = source.agentMaxClimb;
    this.agentMaxSlope = source.agentMaxSlope;
    this.regionMinSize = source.regionMinSize;
    return this;
  }

  serialize() {
    return super.serialize({
      "floor-plan": {
        autoCellSize: this.autoCellSize,
        cellSize: this.cellSize,
        cellHeight: this.cellHeight,
        agentHeight: this.agentHeight,
        agentRadius: this.agentRadius,
        agentMaxClimb: this.agentMaxClimb,
        agentMaxSlope: this.agentMaxSlope,
        regionMinSize: this.regionMinSize
      }
    });
  }

  prepareForExport() {
    super.prepareForExport();
    const material = this.navMesh.material;
    material.transparent = true;
    material.opacity = 0;
    this.addGLTFComponent("visible", { visible: false });
    this.addGLTFComponent("nav-mesh", {});

    if (this.heightfield) {
      this.addGLTFComponent("heightfield", this.heightfield);
    }
  }
}