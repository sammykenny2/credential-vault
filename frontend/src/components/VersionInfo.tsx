import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { APP_REVISION, APP_VERSION, fetchServerBuild, formatBuild, isSameBuild } from '@/lib/version'

const interfaceBuild = { version: APP_VERSION, revision: APP_REVISION }

/** The running build in the sidebar, and a reload hint when the server runs another. */
export default function VersionInfo() {
  // Rechecked when the window regains focus, so a deploy shows up without a reload.
  const { data: serverBuild } = useQuery({
    queryKey: ['server-build'],
    queryFn: fetchServerBuild,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  })
  const outdated = serverBuild !== undefined && !isSameBuild(serverBuild, interfaceBuild)

  return (
    <div className="mt-3 px-4 text-xs text-gray-500">
      <p title="Interface version and commit">{formatBuild(interfaceBuild)}</p>
      {outdated && (
        <button
          onClick={() => window.location.reload()}
          className="mt-1 flex items-start gap-1 text-left text-amber-400 hover:text-amber-300"
        >
          <RefreshCw className="w-3 h-3 mt-0.5 shrink-0" />
          <span>Server runs {formatBuild(serverBuild)}. Reload to switch.</span>
        </button>
      )}
    </div>
  )
}
