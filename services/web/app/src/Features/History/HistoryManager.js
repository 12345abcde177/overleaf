const { callbackify } = require('util')
const fetch = require('node-fetch')
const settings = require('@overleaf/settings')
const OError = require('@overleaf/o-error')
const UserGetter = require('../User/UserGetter')

async function initializeProject() {
  if (
    !(
      settings.apis.project_history &&
      settings.apis.project_history.initializeHistoryForNewProjects
    )
  ) {
    return
  }
  const response = await fetch(`${settings.apis.project_history.url}/project`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
    },
  })
  if (!response.ok) {
    throw new OError('failed to initialize project history', {
      statusCode: response.status,
    })
  }
  const body = await response.json()
  const overleafId = body && body.project && body.project.id
  if (!overleafId) {
    throw new OError('project-history did not provide an id', { body })
  }
  return { overleaf_id: overleafId }
}

async function flushProject(projectId) {
  const response = await fetch(
    `${settings.apis.project_history.url}/project/${projectId}/flush`,
    { method: 'POST' }
  )
  if (!response.ok) {
    throw new OError('failed to flush project to project history', {
      projectId,
      statusCode: response.status,
    })
  }
}

async function deleteProjectHistory(projectId) {
  const response = await fetch(
    `${settings.apis.project_history.url}/project/${projectId}`,
    { method: 'DELETE' }
  )
  if (!response.ok) {
    throw new OError('failed to delete project history', {
      projectId,
      statusCode: response.status,
    })
  }
}

async function resyncProject(projectId, options = {}) {
  const body = {}
  if (options.force) {
    body.force = options.force
  }
  if (options.origin) {
    body.origin = options.origin
  }
  const response = await fetch(
    `${settings.apis.project_history.url}/project/${projectId}/resync`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(6 * 60 * 1000),
    }
  )
  if (!response.ok) {
    throw new OError('failed to resync project history', {
      projectId,
      statusCode: response.status,
    })
  }
}

async function deleteProject(projectId, historyId) {
  const tasks = []
  tasks.push(_deleteProjectInProjectHistory(projectId))
  if (historyId != null) {
    tasks.push(_deleteProjectInFullProjectHistory(historyId))
  }
  await Promise.all(tasks)
}

async function _deleteProjectInProjectHistory(projectId) {
  const response = await fetch(
    `${settings.apis.project_history.url}/project/${projectId}`,
    { method: 'DELETE' }
  )
  if (!response.ok) {
    throw new OError('failed to clear project history in project-history', {
      projectId,
      statusCode: response.status,
    })
  }
}

async function _deleteProjectInFullProjectHistory(historyId) {
  const response = await fetch(
    `${settings.apis.v1_history.url}/projects/${historyId}`,
    {
      method: 'DELETE',
      headers: {
        Authorization:
          'Basic ' +
          Buffer.from(
            `${settings.apis.v1_history.user}:${settings.apis.v1_history.pass}`
          ).toString('base64'),
      },
    }
  )
  if (!response.ok) {
    throw new OError('failed to clear project history', {
      historyId,
      statusCode: response.status,
    })
  }
}

async function injectUserDetails(data) {
  // data can be either:
  // {
  // 	diff: [{
  // 		i: "foo",
  // 		meta: {
  // 			users: ["user_id", v1_user_id, ...]
  // 			...
  // 		}
  // 	}, ...]
  // }
  // or
  // {
  // 	updates: [{
  // 		pathnames: ["main.tex"]
  // 		meta: {
  // 			users: ["user_id", v1_user_id, ...]
  // 			...
  // 		},
  // 		...
  // 	}, ...]
  // }
  // Either way, the top level key points to an array of objects with a meta.users property
  // that we need to replace user_ids with populated user objects.
  // Note that some entries in the users arrays may be v1 ids returned by the v1 history
  // service. v1 ids will be `numbers`
  let userIds = new Set()
  let v1UserIds = new Set()
  const entries = Array.isArray(data.diff)
    ? data.diff
    : Array.isArray(data.updates)
    ? data.updates
    : []
  for (const entry of entries) {
    for (const user of (entry.meta && entry.meta.users) || []) {
      if (typeof user === 'string') {
        userIds.add(user)
      } else if (typeof user === 'number') {
        v1UserIds.add(user)
      }
    }
  }

  userIds = Array.from(userIds)
  v1UserIds = Array.from(v1UserIds)
  const projection = { first_name: 1, last_name: 1, email: 1 }
  const usersArray = await UserGetter.promises.getUsers(userIds, projection)
  const users = {}
  for (const user of usersArray) {
    users[user._id.toString()] = _userView(user)
  }
  projection.overleaf = 1
  const v1IdentifiedUsersArray = await UserGetter.promises.getUsersByV1Ids(
    v1UserIds,
    projection
  )
  for (const user of v1IdentifiedUsersArray) {
    users[user.overleaf.id] = _userView(user)
  }
  for (const entry of entries) {
    if (entry.meta != null) {
      entry.meta.users = ((entry.meta && entry.meta.users) || []).map(user => {
        if (typeof user === 'string' || typeof user === 'number') {
          return users[user]
        } else {
          return user
        }
      })
    }
  }
  return data
}

function _userView(user) {
  const { _id, first_name: firstName, last_name: lastName, email } = user
  return { first_name: firstName, last_name: lastName, email, id: _id }
}

module.exports = {
  initializeProject: callbackify(initializeProject),
  flushProject: callbackify(flushProject),
  resyncProject: callbackify(resyncProject),
  deleteProject: callbackify(deleteProject),
  deleteProjectHistory: callbackify(deleteProjectHistory),
  injectUserDetails: callbackify(injectUserDetails),
  promises: {
    initializeProject,
    flushProject,
    resyncProject,
    deleteProject,
    injectUserDetails,
    deleteProjectHistory,
  },
}
