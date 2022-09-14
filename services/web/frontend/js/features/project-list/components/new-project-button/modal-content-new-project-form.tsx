import { useState } from 'react'
import { Alert, Button, FormControl, Modal } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'
import useAsync from '../../../../shared/hooks/use-async'
import {
  getUserFacingMessage,
  postJSON,
} from '../../../../infrastructure/fetch-json'

type NewProjectData = {
  project_id: string
  owner_ref: string
  owner: {
    first_name: string
    last_name: string
    email: string
    id: string
  }
}

type Props = {
  onCancel: () => void
  template?: string
}

function ModalContentNewProjectForm({ onCancel, template = 'none' }: Props) {
  const { t } = useTranslation()
  const [projectName, setProjectName] = useState('')
  const { isLoading, isError, error, runAsync } = useAsync<NewProjectData>()

  const createNewProject = () => {
    runAsync(
      postJSON('/project/new', {
        body: {
          _csrf: window.csrfToken,
          projectName,
          template,
        },
      })
    )
      .then(data => {
        if (data.project_id) {
          window.location.assign(`/project/${data.project_id}`)
        }
      })
      .catch(() => {})
  }

  const handleChangeName = (
    e: React.ChangeEvent<HTMLInputElement & FormControl>
  ) => {
    setProjectName(e.currentTarget.value)
  }

  return (
    <>
      <Modal.Header closeButton>
        <Modal.Title>{t('new_project')}</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {isError && (
          <Alert bsStyle="danger">{getUserFacingMessage(error)}</Alert>
        )}
        <FormControl
          type="text"
          placeholder={t('project_name')}
          onChange={handleChangeName}
          value={projectName}
        />
      </Modal.Body>

      <Modal.Footer>
        <Button onClick={onCancel}>{t('cancel')}</Button>
        <Button
          bsStyle="primary"
          onClick={createNewProject}
          disabled={projectName === '' || isLoading}
        >
          {t('create')}
        </Button>
      </Modal.Footer>
    </>
  )
}

export default ModalContentNewProjectForm
