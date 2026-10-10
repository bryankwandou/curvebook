import { useEffect, useState } from 'react'

// The data files are refreshed daily by .github/workflows/data.yml and committed to the repo. The site is deployed
// separately, so it reads the latest committed copy at runtime and keeps the bundled copy if that is newer or unreachable.
const RAW = 'https://raw.githubusercontent.com/bryankwandou/curvebook/main/'

export function useLive<T extends { ranAt: string }>(file: string, bundled: T): T {
  const [data, setData] = useState(bundled)
  useEffect(() => {
    fetch(RAW + file, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j && typeof j.ranAt === 'string' && j.ranAt > bundled.ranAt) setData(j)
      })
      .catch(() => {})
  }, [file, bundled])
  return data
}
