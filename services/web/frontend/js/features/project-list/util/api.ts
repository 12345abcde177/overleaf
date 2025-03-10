import { Tag } from '../../../../../app/src/Features/Tags/types'
import {
  GetProjectsResponseBody,
  Sort,
} from '../../../../../types/project/dashboard/api'
import { deleteJSON, postJSON } from '../../../infrastructure/fetch-json'

export function getProjects(sortBy: Sort): Promise<GetProjectsResponseBody> {
  return postJSON('/api/project', { body: { sort: sortBy } })
}

export function createTag(tagName: string): Promise<Tag> {
  return postJSON(`/tag`, {
    body: { name: tagName },
  })
}

export function renameTag(tagId: string, newTagName: string) {
  return postJSON(`/tag/${tagId}/rename`, {
    body: { name: newTagName },
  })
}

export function deleteTag(tagId: string) {
  return deleteJSON(`/tag/${tagId}`)
}

export function addProjectToTag(tagId: string, projectId: string) {
  return postJSON(`/tag/${tagId}/project/${projectId}`)
}

export function removeProjectFromTag(tagId: string, projectId: string) {
  return deleteJSON(`/tag/${tagId}/project/${projectId}`)
}

export function archiveProject(projectId: string) {
  return postJSON(`/project/${projectId}/archive`)
}

export function deleteProject(projectId: string) {
  return deleteJSON(`/project/${projectId}`)
}

export function leaveProject(projectId: string) {
  return postJSON(`/project/${projectId}/leave`)
}

export function renameProject(projectId: string, newName: string) {
  return postJSON(`/project/${projectId}/rename`, {
    body: {
      newProjectName: newName,
    },
  })
}

export function trashProject(projectId: string) {
  return postJSON(`/project/${projectId}/trash`)
}

export function unarchiveProject(projectId: string) {
  return deleteJSON(`/project/${projectId}/archive`)
}

export function untrashProject(projectId: string) {
  return deleteJSON(`/project/${projectId}/trash`)
}
