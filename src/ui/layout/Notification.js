import React, { Component } from "react";
import PropTypes from "prop-types";
import styled from "styled-components";

const NotificationContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
`;

const StyledNotification = styled.div`
  min-height: 24px;
  margin: 1em 20px;
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 1.1em;
  padding: 1em;
  border-radius: 6px;
  background-color: ${props => props.theme.red};
`;

const Content = styled.span`
  max-width: 50vw;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
`;

const ViewMore = styled.div`
  text-align: center;
  margin-left: 1em;
  a {
    color: ${props => props.theme.blue};
  }
`;

export default class Notification extends Component {
  render() {
    const { body, link } = this.props;
    return (
      <NotificationContainer>
        <StyledNotification>
          <Content>{body}</Content>
          <ViewMore>
            <a href={link} target="_blank" rel="noopener noreferrer">
              Learn more
            </a>
          </ViewMore>
        </StyledNotification>
      </NotificationContainer>
    );
  }
}

Notification.propTypes = {
  body: PropTypes.string.isRequired,
  link: PropTypes.string,
  onClosed: PropTypes.func
};
