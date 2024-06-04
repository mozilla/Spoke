import React, { Component } from "react";
import PropTypes from "prop-types";
import NodeEditor from "./NodeEditor";
import InputGroup from "../inputs/InputGroup";
import BooleanInput from "../inputs/BooleanInput";
import { DiceD6 } from "styled-icons/fa-solid/DiceD6";
import AudioParamsProperties from "./AudioParamsProperties";
import { SourceType } from "../../editor/objects/AudioParams";
import SelectInput from "../inputs/SelectInput";
import { AudioZoneShape } from "../../editor/nodes/AudioZoneNode";

export const AudioZoneShapeOptions = Object.keys(AudioZoneShape).map(k => ({
  label: k,
  value: AudioZoneShape[k]
}));

export default class AudioZoneNodeEditor extends Component {
  static propTypes = {
    editor: PropTypes.object,
    node: PropTypes.object,
    multiEdit: PropTypes.bool
  };

  static iconComponent = DiceD6;

  static description = "Defines a 3D area where audio parameters are overriden for contained audio sources.";

  constructor(props) {
    super(props);

    this.state = {
      options: []
    };
  }

  onChangeEnabled = value => {
    this.props.editor.setPropertySelected("enabled", value);
  };

  onChangeInOut = value => {
    this.props.editor.setPropertySelected("inOut", value);
  };

  onChangeOutIn = value => {
    this.props.editor.setPropertySelected("outIn", value);
  };

  onChangeShape = value => {
    this.props.editor.setPropertySelected("shape", value);
  };

  componentDidMount() {
    const options = [];

    const sceneNode = this.props.editor.scene;

    sceneNode.traverse(o => {
      if (o.isNode && o !== sceneNode) {
        options.push({ label: o.name, value: o.uuid, nodeName: o.nodeName });
      }
    });

    this.setState({ options });
  }

  render() {
    const { node } = this.props;

    return (
      <NodeEditor description={AudioZoneNodeEditor.description} {...this.props}>
        <InputGroup name="Enabled" info="If enabled this audio zone will be enable at start">
          <BooleanInput value={node.enabled} onChange={this.onChangeEnabled} />
        </InputGroup>
        <InputGroup
          name="In-Out"
          info="If enabled this audio zone audio parameters will be applied to audio inside it when the listener is outside"
        >
          <BooleanInput value={node.inOut} onChange={this.onChangeInOut} />
        </InputGroup>
        <InputGroup
          name="Out-In"
          info="If enabled this audio zone audio parameters will be applied to audios outside it when the listener is inside"
        >
          <BooleanInput value={node.outIn} onChange={this.onChangeOutIn} />
        </InputGroup>
        <InputGroup name="Shape" info="Shape of the Audio Zone.">
          <SelectInput options={AudioZoneShapeOptions} value={node.shape} onChange={this.onChangeShape} />
        </InputGroup>
        <AudioParamsProperties sourceType={SourceType.AUDIO_ZONE} {...this.props} />
      </NodeEditor>
    );
  }
}
