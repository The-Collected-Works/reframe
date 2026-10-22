import type { ReframeApi } from '@shared/types'

declare global {
  interface Window {
    reframe: ReframeApi
  }
}
