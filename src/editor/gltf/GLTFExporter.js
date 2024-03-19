/**
 * Extracted and modified from Three.js
 * https://github.com/mrdoob/three.js/blob/dev/examples/jsm/exporters/GLTFExporter.js
 * https://github.com/mrdoob/three.js/blob/dev/LICENSE
 **/

/**
 * @author fernandojsg / http://fernandojsg.com
 * @author Don McCurdy / https://www.donmccurdy.com
 * @author Takahiro / https://github.com/takahirox
 */

import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  DoubleSide,
  InterpolateDiscrete,
  InterpolateLinear,
  LinearFilter,
  LinearMipMapLinearFilter,
  LinearMipMapNearestFilter,
  Math as _Math,
  MirroredRepeatWrapping,
  NearestFilter,
  NearestMipMapLinearFilter,
  NearestMipMapNearestFilter,
  PropertyBinding,
  RGBAFormat,
  RepeatWrapping,
  Scene,
  TriangleFanDrawMode,
  TriangleStripDrawMode,
  Vector3,
  Material,
  Texture,
  Object3D
} from "three";

import { LightmapExporterExtension } from "./extensions/exporter/LightmapExporterExtension";

//------------------------------------------------------------------------------
// Constants
//------------------------------------------------------------------------------
const WEBGL_CONSTANTS = {
  POINTS: 0x0000,
  LINES: 0x0001,
  LINE_LOOP: 0x0002,
  LINE_STRIP: 0x0003,
  TRIANGLES: 0x0004,
  TRIANGLE_STRIP: 0x0005,
  TRIANGLE_FAN: 0x0006,

  UNSIGNED_BYTE: 0x1401,
  UNSIGNED_SHORT: 0x1403,
  FLOAT: 0x1406,
  UNSIGNED_INT: 0x1405,
  ARRAY_BUFFER: 0x8892,
  ELEMENT_ARRAY_BUFFER: 0x8893,

  NEAREST: 0x2600,
  LINEAR: 0x2601,
  NEAREST_MIPMAP_NEAREST: 0x2700,
  LINEAR_MIPMAP_NEAREST: 0x2701,
  NEAREST_MIPMAP_LINEAR: 0x2702,
  LINEAR_MIPMAP_LINEAR: 0x2703,

  CLAMP_TO_EDGE: 33071,
  MIRRORED_REPEAT: 33648,
  REPEAT: 10497
};

const THREE_TO_WEBGL = {};

THREE_TO_WEBGL[NearestFilter] = WEBGL_CONSTANTS.NEAREST;
THREE_TO_WEBGL[NearestMipMapNearestFilter] = WEBGL_CONSTANTS.NEAREST_MIPMAP_NEAREST;
THREE_TO_WEBGL[NearestMipMapLinearFilter] = WEBGL_CONSTANTS.NEAREST_MIPMAP_LINEAR;
THREE_TO_WEBGL[LinearFilter] = WEBGL_CONSTANTS.LINEAR;
THREE_TO_WEBGL[LinearMipMapNearestFilter] = WEBGL_CONSTANTS.LINEAR_MIPMAP_NEAREST;
THREE_TO_WEBGL[LinearMipMapLinearFilter] = WEBGL_CONSTANTS.LINEAR_MIPMAP_LINEAR;

THREE_TO_WEBGL[ClampToEdgeWrapping] = WEBGL_CONSTANTS.CLAMP_TO_EDGE;
THREE_TO_WEBGL[RepeatWrapping] = WEBGL_CONSTANTS.REPEAT;
THREE_TO_WEBGL[MirroredRepeatWrapping] = WEBGL_CONSTANTS.MIRRORED_REPEAT;

const PATH_PROPERTIES = {
  scale: "scale",
  position: "translation",
  quaternion: "rotation",
  morphTargetInfluences: "weights"
};

const DEFAULT_OPTIONS = {
  mode: "glb",
  trs: true,
  onlyVisible: true,
  truncateDrawRange: true,
  animations: [],
  forceIndices: false,
  forcePowerOfTwoTextures: false,
  includeCustomExtensions: false
};

//------------------------------------------------------------------------------
// GLTF Exporter
//------------------------------------------------------------------------------
class GLTFExporter {
  constructor(options) {
    this.options = Object.assign({}, DEFAULT_OPTIONS, options);

    if (this.options.animations.length > 0) {
      // Only TRS properties, and not matrices, may be targeted by animation.
      this.options.trs = true;
    }

    this.outputJSON = {
      asset: {
        version: "2.0",
        generator: "GLTFExporter"
      }
    };

    this.outputBuffers = [];
    this.outputImages = [];

    this.byteOffset = 0;
    this.buffers = [];
    this.pending = [];
    this.nodeMap = new Map();
    this.skins = [];
    this.extensionsUsed = {};
    this.cachedData = {
      meshes: new Map(),
      attributes: new Map(),
      attributesRelative: new Map(),
      attributesNormalized: new Map(),
      materials: new Map(),
      textures: new Map(),
      images: new Map()
    };

    this.cachedCanvas = null;

    this.uids = new Map();
    this.uid = 0;

    this.extensions = [];
    this.hooks = [];

    this.registerExtension(LightmapExporterExtension);
  }

  registerExtension(Extension, options = {}) {
    const extension = new Extension(this, options);
    this.extensions.push(extension);
    extension.onRegister();
  }

  addHook(hookName, test, callback) {
    let hooks = this.hooks[hookName];

    if (!hooks) {
      hooks = this.hooks[hookName] = [];
    }

    hooks.push({ test, callback });
  }

  async runFirstHook(hookName, ...args) {
    const hooks = this.hooks[hookName];

    if (hooks) {
      for (const { test, callback } of hooks) {
        if (test(...args)) {
          return callback(...args);
        }
      }
    }

    return undefined;
  }

  async runAllHooks(hookName, ...args) {
    const hooks = this.hooks[hookName];

    const matchedHooks = [];

    if (hooks) {
      for (const { test, callback } of hooks) {
        if (test(...args)) {
          matchedHooks.push(callback(...args));
        }
      }
    }

    return Promise.all(matchedHooks);
  }

  /**
   * Assign and return a temporal unique id for an object
   * especially which doesn't have .uuid
   * @param  {Object} object
   * @return {Integer}
   */
  getUID(object) {
    if (!this.uids.has(object)) this.uids.set(object, this.uid++);

    return this.uids.get(object);
  }

  /**
   * Checks if normal attribute values are normalized.
   *
   * @param {BufferAttribute} normal
   * @returns {Boolean}
   *
   */
  isNormalizedNormalAttribute(normal) {
    if (this.cachedData.attributesNormalized.has(normal)) {
      return false;
    }

    const v = new Vector3();

    for (let i = 0, il = normal.count; i < il; i++) {
      // 0.0005 is from glTF-validator
      if (Math.abs(v.fromArray(normal.array, i * 3).length() - 1.0) > 0.0005) return false;
    }

    return true;
  }

  /**
   * Creates normalized normal buffer attribute.
   *
   * @param {BufferAttribute} normal
   * @returns {BufferAttribute}
   *
   */
  createNormalizedNormalAttribute(normal) {
    if (this.cachedData.attributesNormalized.has(normal)) {
      return this.cachedData.attributesNormalized.get(normal);
    }

    const attribute = normal.clone();

    const v = new Vector3();

    for (let i = 0, il = attribute.count; i < il; i++) {
      v.fromArray(attribute.array, i * 3);

      if (v.x === 0 && v.y === 0 && v.z === 0) {
        // if values can't be normalized set (1, 0, 0)
        v.setX(1.0);
      } else {
        v.normalize();
      }

      v.toArray(attribute.array, i * 3);
    }

    this.cachedData.attributesNormalized.set(normal, attribute);

    return attribute;
  }

  /**
   * Serializes a userData.
   *
   * @param {THREE.Object3D|THREE.Material} object
   * @param {Object} gltfProperty
   */
  serializeUserData(object, gltfProperty) {
    if (Object.keys(object.userData).length === 0) {
      return;
    }

    try {
      const serializedUserData = this.serializeUserDataProperty(object.userData);

      if (this.options.includeCustomExtensions && serializedUserData.gltfExtensions) {
        if (gltfProperty.extensions === undefined) {
          gltfProperty.extensions = {};
        }

        const gltfExtensions = serializedUserData.gltfExtensions;

        for (const extensionName in gltfExtensions) {
          if (!Object.prototype.hasOwnProperty.call(gltfExtensions, extensionName)) continue;
          gltfProperty.extensions[extensionName] = serializedUserData.gltfExtensions[extensionName];
          this.extensionsUsed[extensionName] = true;
        }

        delete serializedUserData.gltfExtensions;
      }

      if (Object.keys(serializedUserData).length > 0) {
        gltfProperty.extras = serializedUserData;
      }
    } catch (error) {
      console.warn(
        "THREE.GLTFExporter: userData of '" +
          object.name +
          "' " +
          "won't be serialized because of an error - " +
          error.message
      );
    }
  }

  serializeUserDataProperty(value) {
    if (value instanceof Material) {
      return this.processMaterial(value);
    } else if (value instanceof Object3D) {
      return this.processNode(value);
    } else if (value instanceof Texture) {
      return this.processTexture(value);
    } else if (value instanceof HTMLImageElement) {
      return this.processImage(value);
    } else if (Array.isArray(value)) {
      return value.map(item => this.serializeUserDataProperty(item));
    } else if (typeof value == "object" && value !== null) {
      const obj = {};

      for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          obj[key] = this.serializeUserDataProperty(value[key]);
        }
      }

      return obj;
    } else {
      return value;
    }
  }

  /**
   * Applies a texture transform, if present, to the map definition. Requires
   * the KHR_texture_transform extension.
   */
  applyTextureTransform(mapDef, texture) {
    let didTransform = false;
    const transformDef = {};

    if (texture.offset.x !== 0 || texture.offset.y !== 0) {
      transformDef.offset = texture.offset.toArray();
      didTransform = true;
    }

    if (texture.rotation !== 0) {
      transformDef.rotation = texture.rotation;
      didTransform = true;
    }

    if (texture.repeat.x !== 1 || texture.repeat.y !== 1) {
      transformDef.scale = texture.repeat.toArray();
      didTransform = true;
    }

    if (didTransform) {
      mapDef.extensions = mapDef.extensions || {};
      mapDef.extensions["KHR_texture_transform"] = transformDef;
      this.extensionsUsed["KHR_texture_transform"] = true;
    }
  }

  /**
   * Process a buffer to append to the default one.
   * @param  {ArrayBuffer} buffer
   * @return {Integer}
   */
  processBuffer(buffer) {
    if (!this.outputJSON.buffers) {
      this.outputJSON.buffers = [{ byteLength: 0 }];
    }

    // All buffers are merged before export.
    this.buffers.push(buffer);

    return 0;
  }

  /**
   * Process and generate a BufferView
   * @param  {BufferAttribute} attribute
   * @param  {number} componentType
   * @param  {number} start
   * @param  {number} count
   * @param  {number} target (Optional) Target usage of the BufferView
   * @return {Object}
   */
  processBufferView(attribute, componentType, start, count, target) {
    if (!this.outputJSON.bufferViews) {
      this.outputJSON.bufferViews = [];
    }

    // Create a new dataview and dump the attribute's array into it

    let componentSize;

    if (componentType === WEBGL_CONSTANTS.UNSIGNED_BYTE) {
      componentSize = 1;
    } else if (componentType === WEBGL_CONSTANTS.UNSIGNED_SHORT) {
      componentSize = 2;
    } else {
      componentSize = 4;
    }

    const byteLength = GLTFExporter.Utils.getPaddedBufferSize(count * attribute.itemSize * componentSize);
    const dataView = new DataView(new ArrayBuffer(byteLength));
    let offset = 0;

    for (let i = start; i < start + count; i++) {
      for (let a = 0; a < attribute.itemSize; a++) {
        // @TODO Fails on InterleavedBufferAttribute, and could probably be
        // optimized for normal BufferAttribute.
        const value = attribute.array[i * attribute.itemSize + a];

        if (componentType === WEBGL_CONSTANTS.FLOAT) {
          dataView.setFloat32(offset, value, true);
        } else if (componentType === WEBGL_CONSTANTS.UNSIGNED_INT) {
          dataView.setUint32(offset, value, true);
        } else if (componentType === WEBGL_CONSTANTS.UNSIGNED_SHORT) {
          dataView.setUint16(offset, value, true);
        } else if (componentType === WEBGL_CONSTANTS.UNSIGNED_BYTE) {
          dataView.setUint8(offset, value);
        }

        offset += componentSize;
      }
    }

    const gltfBufferView = {
      buffer: this.processBuffer(dataView.buffer),
      byteOffset: this.byteOffset,
      byteLength: byteLength
    };

    if (target !== undefined) gltfBufferView.target = target;

    if (target === WEBGL_CONSTANTS.ARRAY_BUFFER) {
      // Only define byteStride for vertex attributes.
      gltfBufferView.byteStride = attribute.itemSize * componentSize;
    }

    this.byteOffset += byteLength;

    this.outputJSON.bufferViews.push(gltfBufferView);

    // @TODO Merge bufferViews where possible.
    const output = {
      id: this.outputJSON.bufferViews.length - 1,
      byteLength: 0
    };

    return output;
  }

  /**
   * Process and generate a BufferView from an image Blob.
   * @param {Blob} blob
   * @return {Promise<Integer>}
   */
  processBufferViewImage(blob) {
    if (!this.outputJSON.bufferViews) {
      this.outputJSON.bufferViews = [];
    }

    return new Promise(resolve => {
      const reader = new window.FileReader();
      reader.readAsArrayBuffer(blob);
      reader.onloadend = () => {
        const buffer = GLTFExporter.Utils.getPaddedArrayBuffer(reader.result);

        const bufferView = {
          buffer: this.processBuffer(buffer),
          byteOffset: this.byteOffset,
          byteLength: buffer.byteLength
        };

        this.byteOffset += buffer.byteLength;

        this.outputJSON.bufferViews.push(bufferView);

        resolve(this.outputJSON.bufferViews.length - 1);
      };
    });
  }

  /**
   * Process attribute to generate an accessor
   * @param  {BufferAttribute} attribute Attribute to process
   * @param  {BufferGeometry} geometry (Optional) Geometry used for truncated draw range
   * @param  {Integer} start (Optional)
   * @param  {Integer} count (Optional)
   * @return {Integer}           Index of the processed accessor on the "accessors" array
   */
  processAccessor(attribute, geometry, start, count) {
    const types = {
      1: "SCALAR",
      2: "VEC2",
      3: "VEC3",
      4: "VEC4",
      16: "MAT4"
    };

    let componentType;

    // Detect the component type of the attribute array (float, uint or ushort)
    if (attribute.array.constructor === Float32Array) {
      componentType = WEBGL_CONSTANTS.FLOAT;
    } else if (attribute.array.constructor === Uint32Array) {
      componentType = WEBGL_CONSTANTS.UNSIGNED_INT;
    } else if (attribute.array.constructor === Uint16Array) {
      componentType = WEBGL_CONSTANTS.UNSIGNED_SHORT;
    } else if (attribute.array.constructor === Uint8Array) {
      componentType = WEBGL_CONSTANTS.UNSIGNED_BYTE;
    } else {
      throw new Error("THREE.GLTFExporter: Unsupported bufferAttribute component type.");
    }

    if (start === undefined) start = 0;
    if (count === undefined) count = attribute.count;

    // @TODO Indexed buffer geometry with drawRange not supported yet
    if (this.options.truncateDrawRange && geometry !== undefined && geometry.index === null) {
      const end = start + count;
      const end2 =
        geometry.drawRange.count === Infinity ? attribute.count : geometry.drawRange.start + geometry.drawRange.count;

      start = Math.max(start, geometry.drawRange.start);
      count = Math.min(end, end2) - start;

      if (count < 0) count = 0;
    }

    // Skip creating an accessor if the attribute doesn't have data to export
    if (count === 0) {
      return null;
    }

    const minMax = GLTFExporter.Utils.getMinMax(attribute, start, count);

    let bufferViewTarget;

    // If geometry isn't provided, don't infer the target usage of the bufferView. For
    // animation samplers, target must not be set.
    if (geometry !== undefined) {
      bufferViewTarget =
        attribute === geometry.index ? WEBGL_CONSTANTS.ELEMENT_ARRAY_BUFFER : WEBGL_CONSTANTS.ARRAY_BUFFER;
    }

    const bufferView = this.processBufferView(attribute, componentType, start, count, bufferViewTarget);

    const gltfAccessor = {
      bufferView: bufferView.id,
      byteOffset: bufferView.byteOffset,
      componentType: componentType,
      count: count,
      max: minMax.max,
      min: minMax.min,
      type: types[attribute.itemSize],
      normalized: attribute.normalized
    };

    if (!this.outputJSON.accessors) {
      this.outputJSON.accessors = [];
    }

    this.outputJSON.accessors.push(gltfAccessor);

    return this.outputJSON.accessors.length - 1;
  }

  async transformImage(image, mimeType, flipY) {
    const shouldResize = this.options.forcePowerOfTwoTextures && !GLTFExporter.Utils.isPowerOfTwo(image);

    if (!shouldResize && !flipY) {
      const response = await fetch(image.src);
      const blob = await response.blob();
      return { blob, src: image.src, width: image.width, height: image.height };
    }

    const canvas = (this.cachedCanvas = this.cachedCanvas || document.createElement("canvas"));

    canvas.width = image.width;
    canvas.height = image.height;

    if (shouldResize) {
      console.warn("GLTFExporter: Resized non-power-of-two image.", image);

      canvas.width = _Math.floorPowerOfTwo(canvas.width);
      canvas.height = _Math.floorPowerOfTwo(canvas.height);
    }

    const ctx = canvas.getContext("2d");

    if (flipY === true) {
      ctx.translate(0, canvas.height);
      ctx.scale(1, -1);
    }

    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, mimeType));

    return { blob, src: image.src, width: canvas.width, height: canvas.height };
  }

  /**
   * Process image
   * @param  {Image} image to process
   * @param  {Integer} format of the image (e.g. THREE.RGBFormat, RGBAFormat etc)
   * @param  {Boolean} flipY before writing out the image
   * @return {Integer}     Index of the processed texture in the "images" array
   */
  processImage(image, format, dataTexture, flipY, name) {
    if (!this.cachedData.images.has(image)) {
      this.cachedData.images.set(image, {});
    }

    const cachedImages = this.cachedData.images.get(image);
    const mimeType = format === RGBAFormat || dataTexture ? "image/png" : "image/jpeg";
    const key = mimeType + ":flipY/" + flipY.toString();

    if (cachedImages[key] !== undefined) {
      return cachedImages[key];
    }

    if (!this.outputJSON.images) {
      this.outputJSON.images = [];
    }

    const gltfImage = { mimeType: mimeType };

    if (name) {
      gltfImage.name = name;
    }

    const index = this.outputJSON.images.length;

    if (this.options.mode === "glb") {
      this.pending.push(
        this.transformImage(image, mimeType, flipY).then(async result => {
          gltfImage.bufferView = await this.processBufferViewImage(result.blob);
          this.outputImages[index] = result;
        })
      );
    } else {
      const fileName = GLTFExporter.Utils.getFileNameFromUri(image.src);
      const extension = mimeType === "image/png" ? ".png" : ".jpg";
      gltfImage.uri = fileName + index + extension;

      this.pending.push(
        this.transformImage(image, mimeType, flipY).then(result => (this.outputImages[index] = result))
      );
    }

    this.outputJSON.images.push(gltfImage);

    cachedImages[key] = index;

    return index;
  }

  /**
   * Process sampler
   * @param  {Texture} map Texture to process
   * @return {Integer}     Index of the processed texture in the "samplers" array
   */
  processSampler(map) {
    if (!this.outputJSON.samplers) {
      this.outputJSON.samplers = [];
    }

    const gltfSampler = {
      magFilter: THREE_TO_WEBGL[map.magFilter],
      minFilter: THREE_TO_WEBGL[map.minFilter],
      wrapS: THREE_TO_WEBGL[map.wrapS],
      wrapT: THREE_TO_WEBGL[map.wrapT]
    };

    this.outputJSON.samplers.push(gltfSampler);

    return this.outputJSON.samplers.length - 1;
  }

  /**
   * Process texture
   * @param  {Texture} map Map to process
   * @return {Integer}     Index of the processed texture in the "textures" array
   */
  processTexture(map, dataTexture) {
    if (this.cachedData.textures.has(map)) {
      return this.cachedData.textures.get(map);
    }

    if (!this.outputJSON.textures) {
      this.outputJSON.textures = [];
    }

    const gltfTexture = {
      sampler: this.processSampler(map),
      source: this.processImage(map.image, map.format, dataTexture, map.flipY, map.name)
    };

    this.outputJSON.textures.push(gltfTexture);

    const index = this.outputJSON.textures.length - 1;
    this.cachedData.textures.set(map, index);

    return index;
  }

  /**
   * Process material
   * @param  {THREE.Material} material Material to process
   * @return {Integer}      Index of the processed material in the "materials" array
   */
  processMaterial(material) {
    const equalArray = GLTFExporter.Utils.equalArray;

    if (this.cachedData.materials.has(material)) {
      return this.cachedData.materials.get(material);
    }

    if (!this.outputJSON.materials) {
      this.outputJSON.materials = [];
    }

    if (material.isShaderMaterial) {
      console.warn("GLTFExporter: THREE.ShaderMaterial not supported.");
      return null;
    }

    // @QUESTION Should we avoid including any attribute that has the default value?
    const gltfMaterial = {
      pbrMetallicRoughness: {}
    };

    if (material.isMeshBasicMaterial) {
      gltfMaterial.extensions = { KHR_materials_unlit: {} };

      this.extensionsUsed["KHR_materials_unlit"] = true;
    } else if (!material.isMeshStandardMaterial) {
      console.warn("GLTFExporter: Use MeshStandardMaterial or MeshBasicMaterial for best results.");
    }

    // pbrMetallicRoughness.baseColorFactor
    const color = material.color.toArray().concat([material.opacity]);

    if (!equalArray(color, [1, 1, 1, 1])) {
      gltfMaterial.pbrMetallicRoughness.baseColorFactor = color;
    }

    if (material.isMeshStandardMaterial) {
      gltfMaterial.pbrMetallicRoughness.metallicFactor = material.metalness;
      gltfMaterial.pbrMetallicRoughness.roughnessFactor = material.roughness;
    } else if (material.isMeshBasicMaterial) {
      gltfMaterial.pbrMetallicRoughness.metallicFactor = 0.0;
      gltfMaterial.pbrMetallicRoughness.roughnessFactor = 0.9;
    } else {
      gltfMaterial.pbrMetallicRoughness.metallicFactor = 0.5;
      gltfMaterial.pbrMetallicRoughness.roughnessFactor = 0.5;
    }

    // pbrMetallicRoughness.metallicRoughnessTexture
    if (material.metalnessMap || material.roughnessMap) {
      if (material.metalnessMap === material.roughnessMap) {
        const metalRoughMapDef = { index: this.processTexture(material.metalnessMap, true) };
        this.applyTextureTransform(metalRoughMapDef, material.metalnessMap);
        gltfMaterial.pbrMetallicRoughness.metallicRoughnessTexture = metalRoughMapDef;
      } else {
        console.warn(
          "THREE.GLTFExporter: Ignoring metalnessMap and roughnessMap because they are not the same Texture."
        );
      }
    }

    // pbrMetallicRoughness.baseColorTexture
    if (material.map) {
      const baseColorMapDef = { index: this.processTexture(material.map) };
      this.applyTextureTransform(baseColorMapDef, material.map);
      gltfMaterial.pbrMetallicRoughness.baseColorTexture = baseColorMapDef;
    }

    if (!(material.isMeshBasicMaterial || material.isLineBasicMaterial || material.isPointsMaterial)) {
      // emissiveFactor
      const emissive = material.emissive
        .clone()
        .multiplyScalar(material.emissiveIntensity)
        .toArray();

      if (!equalArray(emissive, [0, 0, 0])) {
        gltfMaterial.emissiveFactor = emissive;
      }

      // emissiveTexture
      if (material.emissiveMap) {
        const emissiveMapDef = { index: this.processTexture(material.emissiveMap) };
        this.applyTextureTransform(emissiveMapDef, material.emissiveMap);
        gltfMaterial.emissiveTexture = emissiveMapDef;
      }
    }

    // normalTexture
    if (material.normalMap) {
      const normalMapDef = { index: this.processTexture(material.normalMap, true) };

      if (material.normalScale.x !== -1) {
        if (material.normalScale.x !== material.normalScale.y) {
          console.warn("THREE.GLTFExporter: Normal scale components are different, ignoring Y and exporting X.");
        }

        normalMapDef.scale = material.normalScale.x;
      }

      this.applyTextureTransform(normalMapDef, material.normalMap);

      gltfMaterial.normalTexture = normalMapDef;
    }

    // occlusionTexture
    if (material.aoMap) {
      const occlusionMapDef = {
        index: this.processTexture(material.aoMap, true),
        texCoord: 1
      };

      if (material.aoMapIntensity !== 1.0) {
        occlusionMapDef.strength = material.aoMapIntensity;
      }

      this.applyTextureTransform(occlusionMapDef, material.aoMap);

      gltfMaterial.occlusionTexture = occlusionMapDef;
    }

    // alphaMode
    if (material.transparent) {
      gltfMaterial.alphaMode = "BLEND";
    } else if (material.alphaTest > 0.0) {
      gltfMaterial.alphaMode = "MASK";
      gltfMaterial.alphaCutoff = material.alphaTest;
    }

    // doubleSided
    if (material.side === DoubleSide) {
      gltfMaterial.doubleSided = true;
    }

    if (material.name !== "") {
      gltfMaterial.name = material.name;
    }

    this.serializeUserData(material, gltfMaterial);

    this.runAllHooks("addMaterialProperties", material, gltfMaterial);

    this.outputJSON.materials.push(gltfMaterial);

    const index = this.outputJSON.materials.length - 1;
    this.cachedData.materials.set(material, index);

    return index;
  }

  /**
   * Process mesh
   * @param  {THREE.Mesh} mesh Mesh to process
   * @return {Integer}      Index of the processed mesh in the "meshes" array
   */
  processMesh(mesh) {
    const cacheKey = mesh.geometry.uuid + ":" + mesh.material.uuid;
    if (this.cachedData.meshes.has(cacheKey)) {
      return this.cachedData.meshes.get(cacheKey);
    }

    let geometry = mesh.geometry;

    let mode;

    // Use the correct mode
    if (mesh.isLineSegments) {
      mode = WEBGL_CONSTANTS.LINES;
    } else if (mesh.isLineLoop) {
      mode = WEBGL_CONSTANTS.LINE_LOOP;
    } else if (mesh.isLine) {
      mode = WEBGL_CONSTANTS.LINE_STRIP;
    } else if (mesh.isPoints) {
      mode = WEBGL_CONSTANTS.POINTS;
    } else {
      if (!geometry.isBufferGeometry) {
        console.warn("GLTFExporter: Exporting THREE.Geometry will increase file size. Use BufferGeometry instead.");

        const geometryTemp = new BufferGeometry();
        geometryTemp.fromGeometry(geometry);
        geometry = geometryTemp;
      }

      if (mesh.drawMode === TriangleFanDrawMode) {
        console.warn("GLTFExporter: TriangleFanDrawMode and wireframe incompatible.");
        mode = WEBGL_CONSTANTS.TRIANGLE_FAN;
      } else if (mesh.drawMode === TriangleStripDrawMode) {
        mode = mesh.material.wireframe ? WEBGL_CONSTANTS.LINE_STRIP : WEBGL_CONSTANTS.TRIANGLE_STRIP;
      } else {
        mode = mesh.material.wireframe ? WEBGL_CONSTANTS.LINES : WEBGL_CONSTANTS.TRIANGLES;
      }
    }

    const gltfMesh = {};

    const attributes = {};
    const primitives = [];
    const targets = [];

    // Conversion between attributes names in threejs and gltf spec
    const nameConversion = {
      uv: "TEXCOORD_0",
      uv2: "TEXCOORD_1",
      color: "COLOR_0",
      skinWeight: "WEIGHTS_0",
      skinIndex: "JOINTS_0"
    };

    const originalNormal = geometry.getAttribute("normal");

    if (originalNormal !== undefined && !this.isNormalizedNormalAttribute(originalNormal)) {
      console.warn("THREE.GLTFExporter: Creating normalized normal attribute from the non-normalized one.");

      geometry.addAttribute("normal", this.createNormalizedNormalAttribute(originalNormal));
    }

    // @QUESTION Detect if .vertexColors = THREE.VertexColors?
    // For every attribute create an accessor
    let modifiedAttribute = null;
    for (let attributeName in geometry.attributes) {
      // Ignore morph target attributes, which are exported later.
      if (attributeName.substr(0, 5) === "morph") continue;

      const attribute = geometry.attributes[attributeName];
      attributeName = nameConversion[attributeName] || attributeName.toUpperCase();

      // Prefix all geometry attributes except the ones specifically
      // listed in the spec; non-spec attributes are considered custom.
      const validVertexAttributes = /^(POSITION|NORMAL|TANGENT|TEXCOORD_\d+|COLOR_\d+|JOINTS_\d+|WEIGHTS_\d+)$/;
      if (!validVertexAttributes.test(attributeName)) {
        attributeName = "_" + attributeName;
      }

      if (this.cachedData.attributes.has(this.getUID(attribute))) {
        attributes[attributeName] = this.cachedData.attributes.get(this.getUID(attribute));
        continue;
      }

      // JOINTS_0 must be UNSIGNED_BYTE or UNSIGNED_SHORT.
      modifiedAttribute = null;
      const array = attribute.array;
      if (attributeName === "JOINTS_0" && !(array instanceof Uint16Array) && !(array instanceof Uint8Array)) {
        console.warn('GLTFExporter: Attribute "skinIndex" converted to type UNSIGNED_SHORT.');
        modifiedAttribute = new BufferAttribute(new Uint16Array(array), attribute.itemSize, attribute.normalized);
      }

      const accessor = this.processAccessor(modifiedAttribute || attribute, geometry);
      if (accessor !== null) {
        attributes[attributeName] = accessor;
        this.cachedData.attributes.set(this.getUID(attribute), accessor);
      }
    }

    if (originalNormal !== undefined) geometry.addAttribute("normal", originalNormal);

    // Skip if no exportable attributes found
    if (Object.keys(attributes).length === 0) {
      return null;
    }

    // Morph targets
    if (mesh.morphTargetInfluences !== undefined && mesh.morphTargetInfluences.length > 0) {
      const weights = [];
      const targetNames = [];
      const reverseDictionary = {};

      const morphTargetDictionary = mesh.morphTargetDictionary;

      if (morphTargetDictionary !== undefined) {
        for (const key in morphTargetDictionary) {
          if (Object.prototype.hasOwnProperty.call(morphTargetDictionary, key)) {
            reverseDictionary[morphTargetDictionary[key]] = key;
          }
        }
      }

      for (let i = 0; i < mesh.morphTargetInfluences.length; ++i) {
        const target = {};

        let warned = false;

        for (const attributeName in geometry.morphAttributes) {
          if (!Object.prototype.hasOwnProperty.call(geometry.morphAttributes, attributeName)) continue;

          // glTF 2.0 morph supports only POSITION/NORMAL/TANGENT.
          // Three.js doesn't support TANGENT yet.

          if (attributeName !== "position" && attributeName !== "normal") {
            if (!warned) {
              console.warn("GLTFExporter: Only POSITION and NORMAL morph are supported.");
              warned = true;
            }

            continue;
          }

          const attribute = geometry.morphAttributes[attributeName][i];
          const gltfAttributeName = attributeName.toUpperCase();

          // Three.js morph attribute has absolute values while the one of glTF has relative values.
          //
          // glTF 2.0 Specification:
          // https://github.com/KhronosGroup/glTF/tree/master/specification/2.0#morph-targets

          const baseAttribute = geometry.attributes[attributeName];

          if (this.cachedData.attributesRelative.has(this.getUID(attribute))) {
            target[gltfAttributeName] = this.cachedData.attributesRelative.get(this.getUID(attribute));
            continue;
          }

          // Clones attribute not to override
          const relativeAttribute = attribute.clone();

          for (let j = 0, jl = attribute.count; j < jl; j++) {
            relativeAttribute.setXYZ(
              j,
              attribute.getX(j) - baseAttribute.getX(j),
              attribute.getY(j) - baseAttribute.getY(j),
              attribute.getZ(j) - baseAttribute.getZ(j)
            );
          }

          target[gltfAttributeName] = this.processAccessor(relativeAttribute, geometry);
          this.cachedData.attributesRelative.set(this.getUID(baseAttribute), target[gltfAttributeName]);
        }

        targets.push(target);

        weights.push(mesh.morphTargetInfluences[i]);
        if (mesh.morphTargetDictionary !== undefined) targetNames.push(reverseDictionary[i]);
      }

      gltfMesh.weights = weights;

      if (targetNames.length > 0) {
        gltfMesh.extras = {};
        gltfMesh.extras.targetNames = targetNames;
      }
    }

    let forceIndices = this.options.forceIndices;
    const isMultiMaterial = Array.isArray(mesh.material);

    if (isMultiMaterial && geometry.groups.length === 0) return null;

    if (!forceIndices && geometry.index === null && isMultiMaterial) {
      // temporal workaround.
      console.warn("THREE.GLTFExporter: Creating index for non-indexed multi-material mesh.");
      forceIndices = true;
    }

    let didForceIndices = false;

    if (geometry.index === null && forceIndices) {
      const indices = [];

      for (let i = 0, il = geometry.attributes.position.count; i < il; i++) {
        indices[i] = i;
      }

      geometry.setIndex(indices);

      didForceIndices = true;
    }

    const materials = isMultiMaterial ? mesh.material : [mesh.material];
    const groups = isMultiMaterial ? geometry.groups : [{ materialIndex: 0, start: undefined, count: undefined }];

    for (let i = 0, il = groups.length; i < il; i++) {
      const primitive = {
        mode: mode,
        attributes: attributes
      };

      this.serializeUserData(geometry, primitive);

      if (targets.length > 0) primitive.targets = targets;

      if (geometry.index !== null) {
        let cacheKey = this.getUID(geometry.index);

        if (groups[i].start !== undefined || groups[i].count !== undefined) {
          cacheKey += ":" + groups[i].start + ":" + groups[i].count;
        }

        if (this.cachedData.attributes.has(cacheKey)) {
          primitive.indices = this.cachedData.attributes.get(cacheKey);
        } else {
          primitive.indices = this.processAccessor(geometry.index, geometry, groups[i].start, groups[i].count);
          this.cachedData.attributes.set(cacheKey, primitive.indices);
        }

        if (primitive.indices === null) delete primitive.indices;
      }

      const material = this.processMaterial(materials[groups[i].materialIndex]);

      if (material !== null) {
        primitive.material = material;
      }

      primitives.push(primitive);
    }

    if (didForceIndices) {
      geometry.setIndex(null);
    }

    gltfMesh.primitives = primitives;

    if (!this.outputJSON.meshes) {
      this.outputJSON.meshes = [];
    }

    this.outputJSON.meshes.push(gltfMesh);

    const index = this.outputJSON.meshes.length - 1;
    this.cachedData.meshes.set(cacheKey, index);

    return index;
  }

  /**
   * Creates glTF animation entry from AnimationClip object.
   *
   * Status:
   * - Only properties listed in PATH_PROPERTIES may be animated.
   *
   * @param {THREE.AnimationClip} clip
   * @param {THREE.Object3D} root
   * @return {number}
   */
  processAnimation(clip, root) {
    if (!this.outputJSON.animations) {
      this.outputJSON.animations = [];
    }

    clip = GLTFExporter.Utils.mergeMorphTargetTracks(clip.clone(), root);

    const tracks = clip.tracks;
    const channels = [];
    const samplers = [];

    for (let i = 0; i < tracks.length; ++i) {
      const track = tracks[i];
      const trackBinding = PropertyBinding.parseTrackName(track.name);
      let trackNode = PropertyBinding.findNode(root, trackBinding.nodeName);
      const trackProperty = PATH_PROPERTIES[trackBinding.propertyName];

      if (trackBinding.objectName === "bones") {
        if (trackNode.isSkinnedMesh === true) {
          trackNode = trackNode.skeleton.getBoneByName(trackBinding.objectIndex);
        } else {
          trackNode = undefined;
        }
      }

      if (!trackNode || !trackProperty) {
        console.warn('THREE.GLTFExporter: Could not export animation track "%s".', track.name);
        return null;
      }

      const inputItemSize = 1;
      let outputItemSize = track.values.length / track.times.length;

      if (trackProperty === PATH_PROPERTIES.morphTargetInfluences) {
        outputItemSize /= trackNode.morphTargetInfluences.length;
      }

      let interpolation;

      // @TODO export CubicInterpolant(InterpolateSmooth) as CUBICSPLINE

      // Detecting glTF cubic spline interpolant by checking factory method's special property
      // GLTFCubicSplineInterpolant is a custom interpolant and track doesn't return
      // valid value from .getInterpolation().
      if (track.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline === true) {
        interpolation = "CUBICSPLINE";

        // itemSize of CUBICSPLINE keyframe is 9
        // (VEC3 * 3: inTangent, splineVertex, and outTangent)
        // but needs to be stored as VEC3 so dividing by 3 here.
        outputItemSize /= 3;
      } else if (track.getInterpolation() === InterpolateDiscrete) {
        interpolation = "STEP";
      } else {
        interpolation = "LINEAR";
      }

      samplers.push({
        input: this.processAccessor(new BufferAttribute(track.times, inputItemSize)),
        output: this.processAccessor(new BufferAttribute(track.values, outputItemSize)),
        interpolation: interpolation
      });

      channels.push({
        sampler: samplers.length - 1,
        target: {
          node: this.nodeMap.get(trackNode),
          path: trackProperty
        }
      });
    }

    this.outputJSON.animations.push({
      name: clip.name || "clip_" + this.outputJSON.animations.length,
      samplers: samplers,
      channels: channels
    });

    return this.outputJSON.animations.length - 1;
  }

  processSkin(object) {
    const node = this.outputJSON.nodes[this.nodeMap.get(object)];

    const skeleton = object.skeleton;
    const rootJoint = object.skeleton.bones[0];

    if (rootJoint === undefined) return null;

    const joints = [];
    const inverseBindMatrices = new Float32Array(skeleton.bones.length * 16);

    for (let i = 0; i < skeleton.bones.length; ++i) {
      joints.push(this.nodeMap.get(skeleton.bones[i]));

      skeleton.boneInverses[i].toArray(inverseBindMatrices, i * 16);
    }

    if (this.outputJSON.skins === undefined) {
      this.outputJSON.skins = [];
    }

    this.outputJSON.skins.push({
      inverseBindMatrices: this.processAccessor(new BufferAttribute(inverseBindMatrices, 16)),
      joints: joints,
      skeleton: this.nodeMap.get(rootJoint)
    });

    const skinIndex = (node.skin = this.outputJSON.skins.length - 1);

    return skinIndex;
  }

  /**
   * Process camera
   * @param  {THREE.Camera} camera Camera to process
   * @return {Integer}      Index of the processed mesh in the "camera" array
   */
  processCamera(camera) {
    if (!this.outputJSON.cameras) {
      this.outputJSON.cameras = [];
    }

    const isOrtho = camera.isOrthographicCamera;

    const gltfCamera = {
      type: isOrtho ? "orthographic" : "perspective"
    };

    if (isOrtho) {
      gltfCamera.orthographic = {
        xmag: camera.right * 2,
        ymag: camera.top * 2,
        zfar: camera.far <= 0 ? 0.001 : camera.far,
        znear: camera.near < 0 ? 0 : camera.near
      };
    } else {
      gltfCamera.perspective = {
        aspectRatio: camera.aspect,
        yfov: _Math.degToRad(camera.fov),
        zfar: camera.far <= 0 ? 0.001 : camera.far,
        znear: camera.near < 0 ? 0 : camera.near
      };
    }

    if (camera.name !== "") {
      gltfCamera.name = camera.type;
    }

    this.outputJSON.cameras.push(gltfCamera);

    return this.outputJSON.cameras.length - 1;
  }

  /**
   * Process Object3D node
   * @param  {THREE.Object3D} node Object3D to processNode
   * @return {Integer}      Index of the node in the nodes list
   */
  processNode(object) {
    const equalArray = GLTFExporter.Utils.equalArray;

    if (!this.outputJSON.nodes) {
      this.outputJSON.nodes = [];
    }

    const gltfNode = {};

    if (this.options.trs) {
      const rotation = object.quaternion.toArray();
      const position = object.position.toArray();
      const scale = object.scale.toArray();

      if (!equalArray(rotation, [0, 0, 0, 1])) {
        gltfNode.rotation = rotation;
      }

      if (!equalArray(position, [0, 0, 0])) {
        gltfNode.translation = position;
      }

      if (!equalArray(scale, [1, 1, 1])) {
        gltfNode.scale = scale;
      }
    } else {
      if (object.matrixAutoUpdate) {
        object.updateMatrix();
      }

      if (!equalArray(object.matrix.elements, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])) {
        gltfNode.matrix = object.matrix.elements;
      }
    }

    // We don't export empty strings name because it represents no-name in Three.js.
    if (object.name !== "") {
      gltfNode.name = String(object.name);
    }

    if (object.isMesh || object.isLine || object.isPoints) {
      const mesh = this.processMesh(object);

      if (mesh !== null) {
        gltfNode.mesh = mesh;
      }
    } else if (object.isCamera) {
      gltfNode.camera = this.processCamera(object);
    }

    if (object.isSkinnedMesh) {
      this.skins.push(object);
    }

    if (object.children.length > 0) {
      const children = [];

      for (let i = 0, l = object.children.length; i < l; i++) {
        const child = object.children[i];

        if (child.visible || this.options.onlyVisible === false) {
          const node = this.processNode(child);

          if (node !== null) {
            children.push(node);
          }
        }
      }

      if (children.length > 0) {
        gltfNode.children = children;
      }
    }

    this.serializeUserData(object, gltfNode);

    this.outputJSON.nodes.push(gltfNode);

    const nodeIndex = this.outputJSON.nodes.length - 1;
    this.nodeMap.set(object, nodeIndex);

    return nodeIndex;
  }

  /**
   * Process Scene
   * @param  {Scene} node Scene to process
   */
  processScene(scene) {
    if (!this.outputJSON.scenes) {
      this.outputJSON.scenes = [];
      this.outputJSON.scene = 0;
    }

    const gltfScene = {
      nodes: []
    };

    if (scene.name !== "") {
      gltfScene.name = scene.name;
    }

    this.outputJSON.scenes.push(gltfScene);

    const nodes = [];

    for (let i = 0, l = scene.children.length; i < l; i++) {
      const child = scene.children[i];

      if (child.visible || this.options.onlyVisible === false) {
        const node = this.processNode(child);

        if (node !== null) {
          nodes.push(node);
        }
      }
    }

    if (nodes.length > 0) {
      gltfScene.nodes = nodes;
    }

    this.serializeUserData(scene, gltfScene);

    return this.outputJSON.scenes.length - 1;
  }

  processInput(input) {
    input = input instanceof Array ? input : [input];

    const objectsWithoutScene = [];

    for (let i = 0; i < input.length; i++) {
      if (input[i] instanceof Scene) {
        this.processScene(input[i]);
      } else {
        objectsWithoutScene.push(input[i]);
      }
    }

    if (objectsWithoutScene.length > 0) {
      this.processObjects(objectsWithoutScene);
    }

    for (let i = 0; i < this.skins.length; ++i) {
      this.processSkin(this.skins[i]);
    }

    for (let i = 0; i < this.options.animations.length; ++i) {
      this.processAnimation(this.options.animations[i], input[0]);
    }
  }

  postProcessBuffers() {
    if (this.outputJSON.buffers && this.outputJSON.buffers.length > 0) {
      // Merge buffers
      const blob = new Blob(this.buffers, { type: "application/octet-stream" });

      // Update bytelength of the single buffer.
      this.outputJSON.buffers[0].byteLength = blob.size;

      if (this.options.mode === "gltf") {
        this.outputJSON.buffers[0].uri = "scene.bin";
      }

      this.outputBuffers.push(blob);
    }
  }

  async exportChunks(input) {
    this.processInput(input);

    await Promise.all(this.pending);

    this.postProcessBuffers();

    // Declare extensions.
    const extensionsUsedList = Object.keys(this.extensionsUsed);
    if (extensionsUsedList.length > 0) this.outputJSON.extensionsUsed = extensionsUsedList;

    return {
      json: this.outputJSON,
      buffers: this.outputBuffers,
      images: this.outputImages
    };
  }

  /**
   * Given a chunks object returned by GLTFLoader.parseChunks, create a blob storing a valid .glb.
   * @param  {Object} chunks  chunks object returned by GLTFLoader.parseChunks
   * @param  {Function} onDone  Callback on completed
   * @param  {Function} onError  Callback on error
   */
  async exportGLBBlob(chunks) {
    if (chunks.buffers.length > 1) {
      throw new Error("GLTFExporter: exportGLB expects 0 or 1 buffers.");
    }

    // https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md#glb-file-format-specification

    const GLB_HEADER_BYTES = 12;
    const GLB_HEADER_MAGIC = 0x46546c67;
    const GLB_VERSION = 2;

    const GLB_CHUNK_PREFIX_BYTES = 8;
    const GLB_CHUNK_TYPE_JSON = 0x4e4f534a;
    const GLB_CHUNK_TYPE_BIN = 0x004e4942;

    function readBinArrayBuffer(blob) {
      return new Promise((resolve, reject) => {
        const reader = new window.FileReader();

        reader.readAsArrayBuffer(blob);
        reader.onloadend = () => {
          const binaryChunk = GLTFExporter.Utils.getPaddedArrayBuffer(reader.result);
          resolve(binaryChunk);
        };

        reader.onerror = reject;
      });
    }

    /**
     * Converts a string to an ArrayBuffer.
     * @param  {string} text
     * @return {ArrayBuffer}
     */
    function stringToArrayBuffer(text) {
      if (window.TextEncoder !== undefined) {
        return new TextEncoder().encode(text).buffer;
      }

      const array = new Uint8Array(new ArrayBuffer(text.length));

      for (let i = 0, il = text.length; i < il; i++) {
        const value = text.charCodeAt(i);

        // Replacing multi-byte character with space(0x20).
        array[i] = value > 0xff ? 0x20 : value;
      }

      return array.buffer;
    }

    const pending = [];
    const blobParts = [];

    // GLB header.
    const header = new ArrayBuffer(GLB_HEADER_BYTES);
    const headerView = new DataView(header);
    headerView.setUint32(0, GLB_HEADER_MAGIC, true);
    headerView.setUint32(4, GLB_VERSION, true);

    blobParts.push(header);

    // JSON chunk.
    const jsonChunk = GLTFExporter.Utils.getPaddedArrayBuffer(stringToArrayBuffer(JSON.stringify(chunks.json)), 0x20);
    const jsonChunkPrefix = new DataView(new ArrayBuffer(GLB_CHUNK_PREFIX_BYTES));
    jsonChunkPrefix.setUint32(0, jsonChunk.byteLength, true);
    jsonChunkPrefix.setUint32(4, GLB_CHUNK_TYPE_JSON, true);

    blobParts.push(jsonChunkPrefix, jsonChunk);

    if (chunks.buffers.length !== 0) {
      const pendingBinChunk = readBinArrayBuffer(chunks.buffers[0]).then(binaryChunk => {
        const binaryChunkPrefix = new DataView(new ArrayBuffer(GLB_CHUNK_PREFIX_BYTES));
        binaryChunkPrefix.setUint32(0, binaryChunk.byteLength, true);
        binaryChunkPrefix.setUint32(4, GLB_CHUNK_TYPE_BIN, true);

        const totalByteLength =
          GLB_HEADER_BYTES +
          jsonChunkPrefix.byteLength +
          jsonChunk.byteLength +
          binaryChunkPrefix.byteLength +
          binaryChunk.byteLength;
        headerView.setUint32(8, totalByteLength, true);

        blobParts.push(binaryChunkPrefix, binaryChunk);
      });

      pending.push(pendingBinChunk);
    } else {
      const totalByteLength = GLB_HEADER_BYTES + jsonChunkPrefix.byteLength + jsonChunk.byteLength;
      headerView.setUint32(8, totalByteLength, true);
    }

    await Promise.all(pending);

    return new Blob(blobParts, { type: "application/octet-stream" });
  }
}

GLTFExporter.Utils = {
  /**
   * Compare two arrays
   * @param  {Array} array1 Array 1 to compare
   * @param  {Array} array2 Array 2 to compare
   * @return {Boolean}        Returns true if both arrays are equal
   */
  equalArray(array1, array2) {
    return (
      array1.length === array2.length &&
      array1.every((element, index) => {
        return element === array2[index];
      })
    );
  },

  /**
   * Get the min and max vectors from the given attribute
   * @param  {BufferAttribute} attribute Attribute to find the min/max in range from start to start + count
   * @param  {Integer} start
   * @param  {Integer} count
   * @return {Object} Object containing the `min` and `max` values (As an array of attribute.itemSize components)
   */
  getMinMax(attribute, start, count) {
    const output = {
      min: new Array(attribute.itemSize).fill(Number.POSITIVE_INFINITY),
      max: new Array(attribute.itemSize).fill(Number.NEGATIVE_INFINITY)
    };

    for (let i = start; i < start + count; i++) {
      for (let a = 0; a < attribute.itemSize; a++) {
        const value = attribute.array[i * attribute.itemSize + a];
        output.min[a] = Math.min(output.min[a], value);
        output.max[a] = Math.max(output.max[a], value);
      }
    }

    return output;
  },

  /**
   * Checks if image size is POT.
   *
   * @param {Image} image The image to be checked.
   * @returns {Boolean} Returns true if image size is POT.
   *
   */
  isPowerOfTwo(image) {
    return _Math.isPowerOfTwo(image.width) && _Math.isPowerOfTwo(image.height);
  },

  getFileNameFromUri(uri) {
    const parts = uri
      .split("#")
      .shift()
      .split("?")
      .shift()
      .split("/")
      .pop()
      .split(".");

    if (parts.length > 1) {
      parts.pop();
    }

    return parts.join();
  },

  /**
   * Get the required size + padding for a buffer, rounded to the next 4-byte boundary.
   * https://github.com/KhronosGroup/glTF/tree/master/specification/2.0#data-alignment
   *
   * @param {Integer} bufferSize The size the original buffer.
   * @returns {Integer} new buffer size with required padding.
   *
   */
  getPaddedBufferSize(bufferSize) {
    return Math.ceil(bufferSize / 4) * 4;
  },

  /**
   * Returns a buffer aligned to 4-byte boundary.
   *
   * @param {ArrayBuffer} arrayBuffer Buffer to pad
   * @param {Integer} paddingByte (Optional)
   * @returns {ArrayBuffer} The same buffer if it's already aligned to 4-byte boundary or a new buffer
   */
  getPaddedArrayBuffer(arrayBuffer, paddingByte) {
    paddingByte = paddingByte || 0;

    const paddedLength = GLTFExporter.Utils.getPaddedBufferSize(arrayBuffer.byteLength);

    if (paddedLength !== arrayBuffer.byteLength) {
      const array = new Uint8Array(paddedLength);
      array.set(new Uint8Array(arrayBuffer));

      if (paddingByte !== 0) {
        for (let i = arrayBuffer.byteLength; i < paddedLength; i++) {
          array[i] = paddingByte;
        }
      }

      return array.buffer;
    }

    return arrayBuffer;
  },

  insertKeyframe: function(track, time) {
    const tolerance = 0.001; // 1ms
    const valueSize = track.getValueSize();

    const times = new track.TimeBufferType(track.times.length + 1);
    const values = new track.ValueBufferType(track.values.length + valueSize);
    const interpolant = track.createInterpolant(new track.ValueBufferType(valueSize));

    let index;

    if (track.times.length === 0) {
      times[0] = time;

      for (let i = 0; i < valueSize; i++) {
        values[i] = 0;
      }

      index = 0;
    } else if (time < track.times[0]) {
      if (Math.abs(track.times[0] - time) < tolerance) return 0;

      times[0] = time;
      times.set(track.times, 1);

      values.set(interpolant.evaluate(time), 0);
      values.set(track.values, valueSize);

      index = 0;
    } else if (time > track.times[track.times.length - 1]) {
      if (Math.abs(track.times[track.times.length - 1] - time) < tolerance) {
        return track.times.length - 1;
      }

      times[times.length - 1] = time;
      times.set(track.times, 0);

      values.set(track.values, 0);
      values.set(interpolant.evaluate(time), track.values.length);

      index = times.length - 1;
    } else {
      for (let i = 0; i < track.times.length; i++) {
        if (Math.abs(track.times[i] - time) < tolerance) return i;

        if (track.times[i] < time && track.times[i + 1] > time) {
          times.set(track.times.slice(0, i + 1), 0);
          times[i + 1] = time;
          times.set(track.times.slice(i + 1), i + 2);

          values.set(track.values.slice(0, (i + 1) * valueSize), 0);
          values.set(interpolant.evaluate(time), (i + 1) * valueSize);
          values.set(track.values.slice((i + 1) * valueSize), (i + 2) * valueSize);

          index = i + 1;

          break;
        }
      }
    }

    track.times = times;
    track.values = values;

    return index;
  },

  mergeMorphTargetTracks: function(clip, root) {
    const tracks = [];
    const mergedTracks = {};
    const sourceTracks = clip.tracks;

    for (let i = 0; i < sourceTracks.length; ++i) {
      let sourceTrack = sourceTracks[i];
      const sourceTrackBinding = PropertyBinding.parseTrackName(sourceTrack.name);
      const sourceTrackNode = PropertyBinding.findNode(root, sourceTrackBinding.nodeName);

      if (
        sourceTrackBinding.propertyName !== "morphTargetInfluences" ||
        sourceTrackBinding.propertyIndex === undefined
      ) {
        // Tracks that don't affect morph targets, or that affect all morph targets together, can be left as-is.
        tracks.push(sourceTrack);
        continue;
      }

      if (
        sourceTrack.createInterpolant !== sourceTrack.InterpolantFactoryMethodDiscrete &&
        sourceTrack.createInterpolant !== sourceTrack.InterpolantFactoryMethodLinear
      ) {
        if (sourceTrack.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline) {
          // This should never happen, because glTF morph target animations
          // affect all targets already.
          throw new Error("THREE.GLTFExporter: Cannot merge tracks with glTF CUBICSPLINE interpolation.");
        }

        console.warn("THREE.GLTFExporter: Morph target interpolation mode not yet supported. Using LINEAR instead.");

        sourceTrack = sourceTrack.clone();
        sourceTrack.setInterpolation(InterpolateLinear);
      }

      const targetCount = sourceTrackNode.morphTargetInfluences.length;
      const targetIndex = sourceTrackNode.morphTargetDictionary[sourceTrackBinding.propertyIndex];

      if (targetIndex === undefined) {
        throw new Error("THREE.GLTFExporter: Morph target name not found: " + sourceTrackBinding.propertyIndex);
      }

      let mergedTrack;

      // If this is the first time we've seen this object, create a new
      // track to store merged keyframe data for each morph target.
      if (mergedTracks[sourceTrackNode.uuid] === undefined) {
        mergedTrack = sourceTrack.clone();

        const values = new mergedTrack.ValueBufferType(targetCount * mergedTrack.times.length);

        for (let j = 0; j < mergedTrack.times.length; j++) {
          values[j * targetCount + targetIndex] = mergedTrack.values[j];
        }

        mergedTrack.name = ".morphTargetInfluences";
        mergedTrack.values = values;

        mergedTracks[sourceTrackNode.uuid] = mergedTrack;
        tracks.push(mergedTrack);

        continue;
      }

      const sourceInterpolant = sourceTrack.createInterpolant(new sourceTrack.ValueBufferType(1));

      mergedTrack = mergedTracks[sourceTrackNode.uuid];

      // For every existing keyframe of the merged track, write a (possibly
      // interpolated) value from the source track.
      for (let j = 0; j < mergedTrack.times.length; j++) {
        mergedTrack.values[j * targetCount + targetIndex] = sourceInterpolant.evaluate(mergedTrack.times[j]);
      }

      // For every existing keyframe of the source track, write a (possibly
      // new) keyframe to the merged track. Values from the previous loop may
      // be written again, but keyframes are de-duplicated.
      for (let j = 0; j < sourceTrack.times.length; j++) {
        const keyframeIndex = this.insertKeyframe(mergedTrack, sourceTrack.times[j]);
        mergedTrack.values[keyframeIndex * targetCount + targetIndex] = sourceTrack.values[j];
      }
    }

    clip.tracks = tracks;

    return clip;
  }
};

export { GLTFExporter };
