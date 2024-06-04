import React, { Component } from "react";
import PropTypes from "prop-types";
import configs from "../../configs";
import { withApi } from "../contexts/ApiContext";
import NavBar from "../navigation/NavBar";
import {
  ProjectGrid,
  ProjectGridContainer,
  ProjectGridHeader,
  ProjectGridHeaderRow,
  ProjectGridContent,
  ErrorMessage
} from "./ProjectGrid";
import { Button } from "../inputs/Button";
import Footer from "../navigation/Footer";
import { MediumButton } from "../inputs/Button";
import { Link } from "react-router-dom";
import LatestUpdate from "../whats-new/LatestUpdate";
import { connectMenu, ContextMenu, MenuItem } from "../layout/ContextMenu";
import styled from "styled-components";
import Notification from "../layout/Notification";

export const ProjectsSection = styled.section`
  padding-bottom: 100px;
  display: flex;
  flex: ${props => (props.flex === undefined ? 1 : props.flex)};

  &:first-child {
    padding-top: 100px;
  }

  h1 {
    font-size: 36px;
  }

  h2 {
    font-size: 16px;
  }
`;

export const ProjectsContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  margin: 0 auto;
  max-width: 1200px;
  padding: 0 20px;
`;

const WelcomeContainer = styled(ProjectsContainer)`
  align-items: center;

  & > * {
    text-align: center;
  }

  & > *:not(:first-child) {
    margin-top: 20px;
  }

  h2 {
    max-width: 480px;
  }
`;

export const ProjectsHeader = styled.div`
  margin-bottom: 36px;
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const contextMenuId = "project-menu";

class ProjectsPage extends Component {
  static propTypes = {
    api: PropTypes.object.isRequired,
    history: PropTypes.object.isRequired
  };

  constructor(props) {
    super(props);

    const isAuthenticated = this.props.api.isAuthenticated();

    this.state = {
      projects: [],
      scenes: [],
      loading: isAuthenticated,
      isAuthenticated,
      error: null,
      showGlobalNotification: false,
      globalNotificationBody: null,
      globalNotificationLink: null
    };
  }

  componentDidMount() {
    document.title = configs.longName();

    // We dont need to load projects if the user isn't logged in
    if (this.state.isAuthenticated) {
      Promise.all([this.props.api.getProjects(), this.props.api.getProjectlessScenes()])
        .then(([projects, scenes]) => {
          this.setState({
            scenes: scenes.map(scene => ({
              ...scene,
              url: `/scenes/${scene.scene_id}`
            })),
            projects: projects.map(project => ({
              ...project,
              url: `/projects/${project.project_id}`
            })),
            loading: false
          });
        })
        .catch(error => {
          console.error(error);

          if (error.response && error.response.status === 401) {
            // User has an invalid auth token. Prompt them to login again.
            this.props.api.logout();
            return this.props.history.push("/login", { from: "/projects" });
          }

          this.setState({ error, loading: false });
        });
    }

    this.setState({
      showGlobalNotification: true,
      globalNotificationBody: "COPY HERE",
      globalNotificationLink: "https://mozilla.org"
    });
  }

  onDeleteProject = project => {
    this.props.api
      .deleteProject(project.project_id)
      .then(() => this.setState({ projects: this.state.projects.filter(p => p.project_id !== project.project_id) }))
      .catch(error => this.setState({ error }));
  };

  renderContextMenu = props => {
    return (
      <ContextMenu id={contextMenuId}>
        <MenuItem onClick={e => this.onDeleteProject(props.trigger.project, e)}>Delete Project</MenuItem>
      </ContextMenu>
    );
  };

  ProjectContextMenu = connectMenu(contextMenuId)(this.renderContextMenu);

  render() {
    const { error, loading, projects, scenes, isAuthenticated } = this.state;

    const ProjectContextMenu = this.ProjectContextMenu;

    return (
      <>
        <NavBar />
        <main>
          {!isAuthenticated || (projects.length === 0 && !loading) ? (
            <ProjectsSection flex={0}>
              <WelcomeContainer>
                <h1>Welcome{configs.isMoz() ? " to Spoke" : ""}</h1>
                <h2>
                  If you&#39;re new here we recommend going through the tutorial. Otherwise, jump right in and create a
                  project from scratch or from one of our templates.
                </h2>
                <MediumButton as={Link} to="/projects/tutorial">
                  Start Tutorial
                </MediumButton>
              </WelcomeContainer>
            </ProjectsSection>
          ) : (
            <LatestUpdate />
          )}
          <ProjectsSection>
            <ProjectsContainer>
              <ProjectsHeader>
                <h1>Projects</h1>
              </ProjectsHeader>
              <ProjectGridContainer>
                {this.state.showGlobalNotification && (
                  <Notification body={this.state.globalNotificationBody} link={this.state.globalNotificationLink} />
                )}
                <ProjectGridHeader>
                  <ProjectGridHeaderRow></ProjectGridHeaderRow>
                  <ProjectGridHeaderRow>
                    <Button as={Link} to="/projects/create">
                      New Project
                    </Button>
                  </ProjectGridHeaderRow>
                </ProjectGridHeader>
                <ProjectGridContent>
                  {error && <ErrorMessage>{error.message}</ErrorMessage>}
                  {!error && (
                    <ProjectGrid
                      loading={loading}
                      projects={projects}
                      scenes={scenes}
                      newProjectPath="/projects/templates"
                      contextMenuId={contextMenuId}
                    />
                  )}
                </ProjectGridContent>
              </ProjectGridContainer>
            </ProjectsContainer>
          </ProjectsSection>
          <ProjectContextMenu />
        </main>
        <Footer />
      </>
    );
  }
}

export default withApi(ProjectsPage);
