import {
  Material,
  BoxBufferGeometry,
  LineSegments,
  EdgesGeometry,
  BoxGeometry,
  SphereGeometry,
  LineBasicMaterial,
  Quaternion
} from "three";
import AudioParams, { AudioElementType } from "../objects/AudioParams";
import AudioParamsNode from "./AudioParamsNode";

const requiredProperties = ["enabled", "inOut", "outIn"];

const DEBUG_BBAA_COLOR = 0x49ef4;
const debugMaterial = new LineBasicMaterial({
  color: DEBUG_BBAA_COLOR,
  linewidth: 2
});

export const AudioZoneShape = Object.freeze({
  Box: "box",
  Sphere: "sphere"
});

export default class AudioZoneNode extends AudioParamsNode(AudioParams) {
  static componentName = "audio-zone";

  static nodeName = "Audio Zone";

  static _geometry = new BoxBufferGeometry();

  static _material = new Material();

  static optionalProperties = {
    "audio-params": [
      "audioType",
      "gain",
      "distanceModel",
      "rolloffFactor",
      "refDistance",
      "maxDistance",
      "coneInnerAngle",
      "coneOuterAngle",
      "coneOuterGain"
    ]
  };

  static async deserialize(editor, json, loadAsync, onError) {
    const node = await super.deserialize(editor, json, loadAsync, onError);

    const zoneProps = json.components.find(c => c.name === "audio-zone").props;

    node.enabled = zoneProps.enabled;
    node.inOut = zoneProps.inOut;
    node.outIn = zoneProps.outIn;
    node.shape = zoneProps.shape || AudioZoneShape.Box;

    return node;
  }

  constructor(editor) {
    super(editor, AudioElementType.AUDIO_ZONE);

    this.enabled = true;
    this.inOut = true;
    this.outIn = true;
    this.shape = AudioZoneShape.Box;
  }

  set shape(shape) {
    this._shape = shape;

    this.remove(this.helper);
    let geo;
    if (shape === AudioZoneShape.Box) {
      geo = new BoxGeometry();
    } else {
      geo = new SphereGeometry();
    }
    const debugMesh = new LineSegments(new EdgesGeometry(geo), debugMaterial);
    debugMesh.layers.set(1);
    this.helper = debugMesh;
    this.add(debugMesh);
    this.matrixAutoUpdate = false;
  }

  get shape() {
    return this._shape;
  }

  onUpdate = (function() {
    const quat = new Quaternion();
    return function() {
      this.quaternion.set(0, 0, 0, 1);
      this.quaternion.multiply(this.parent.getWorldQuaternion(quat).inverse());
      this.updateMatrix();
    };
  })();

  copy(source, recursive = true) {
    if (recursive) {
      this.remove(this.helper);
    }

    super.copy(source, recursive);

    if (recursive) {
      const helperIndex = source.children.indexOf(source.helper);

      if (helperIndex !== -1) {
        this.helper = this.children[helperIndex];
      }
    }

    this.enabled = source.enabled;
    this.inOut = source.inOut;
    this.outIn = source.outIn;
    this._shape = source.shape;

    return this;
  }

  serialize() {
    return super.serialize({
      "audio-zone": {
        enabled: this.enabled,
        inOut: this.inOut,
        outIn: this.outIn,
        shape: this.shape
      }
    });
  }

  prepareForExport() {
    super.prepareForExport();
    this.remove(this.helper);

    for (const prop of requiredProperties) {
      if (this[prop] === null || this[prop] === undefined) {
        console.warn(`AudioZone: property "${prop}" is required. Skipping...`);
        return;
      }
    }

    this.addGLTFComponent("audio-zone", {
      target: this.gltfIndexForUUID(this.target),
      enabled: this.enabled,
      inOut: this.inOut,
      outIn: this.outIn,
      shape: this.shape
    });
  }
}
