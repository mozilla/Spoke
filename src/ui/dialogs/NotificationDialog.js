import React, { Component } from "react";
import PropTypes from "prop-types";
import Dialog, { DialogContent } from "./Dialog";
import styled from "styled-components";
import { Button } from "../inputs/Button";

const NotificationDialogContainer = styled(Dialog)`
  max-width: 600px;

  ${DialogContent} {
    padding: 0;
  }
`;

const NotificationMessage = styled.code`
  white-space: pre-wrap;
  overflow-wrap: break-word;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 16px;
  color: ${props => props.theme.red};
`;

export default class NotificationDialog extends Component {
  componentDidMount() {}

  openLink = () => {
    window.open(this.props.link);
    this.props.onClosed();
  };

  renderBottomNav() {
    return this.props.link ? <Button onClick={this.openLink}>Learn More</Button> : null;
  }

  render() {
    const { message, onClosed, ...props } = this.props;

    return (
      <NotificationDialogContainer {...props} bottomNav={this.renderBottomNav()}>
        <NotificationMessage>{message}</NotificationMessage>
      </NotificationDialogContainer>
    );
  }
}

NotificationDialog.propTypes = {
  title: PropTypes.string.isRequired,
  message: PropTypes.string.isRequired,
  link: PropTypes.string,
  onClosed: PropTypes.func
};

NotificationDialog.defaultProps = {
  title: "Notification"
};
