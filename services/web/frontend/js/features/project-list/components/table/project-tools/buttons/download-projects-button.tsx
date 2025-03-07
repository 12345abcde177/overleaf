import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from '../../../../../../shared/components/icon'
import Tooltip from '../../../../../../shared/components/tooltip'
import * as eventTracking from '../../../../../../infrastructure/event-tracking'
import { useProjectListContext } from '../../../../context/project-list-context'

function DownloadProjectsButton() {
  const { selectedProjects, selectOrUnselectAllProjects } =
    useProjectListContext()
  const { t } = useTranslation()
  const text = t('download')

  const projectIds = selectedProjects.map(p => p.id)

  const handleDownloadProjects = useCallback(() => {
    eventTracking.send(
      'project-list-page-interaction',
      'project action',
      'Download Zip'
    )

    window.location.assign(
      `/project/download/zip?project_ids=${projectIds.join(',')}`
    )

    const selected = false
    selectOrUnselectAllProjects(selected)
  }, [projectIds, selectOrUnselectAllProjects])

  return (
    <Tooltip
      id="tooltip-download-projects"
      description={text}
      overlayProps={{ placement: 'bottom', trigger: ['hover', 'focus'] }}
    >
      <button
        className="btn btn-default"
        aria-label={text}
        onClick={handleDownloadProjects}
      >
        <Icon type="cloud-download" />
      </button>
    </Tooltip>
  )
}

export default memo(DownloadProjectsButton)
