// Whether the window is a phone's: the layout for narrow screens.

import { useSyncExternalStore } from 'react'

const mq = matchMedia('(max-width: 760px)')

export const isMobile = () => mq.matches

export function useMobile(): boolean {
  return useSyncExternalStore(
    (cb) => {
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => mq.matches,
  )
}
