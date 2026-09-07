// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore, type ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {} from '../src/client/index.js'
import { MarketOverlay, type MarketOverlayProps } from '../src/client/MarketOverlay.js'
import { createMarketViewStore } from '../src/client/market-view-store.js'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => {
  const passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>
  const Button = ({
    children,
    icon,
    size: _size,
    variant: _variant,
    type = 'button',
    ...props
  }: { children?: ReactNode; icon?: ReactNode; size?: string; variant?: string; type?: 'button' | 'submit'; [key: string]: unknown }) => (
    <button type={type} {...props}>{icon}{children}</button>
  )
  const Input = ({ icon: _icon, ...props }: { icon?: ReactNode; [key: string]: unknown }) => <input {...props} />
  const Modal = ({
    open,
    title,
    children,
    footer,
    className,
    contentClassName,
  }: {
    open: boolean
    title: string
    children?: ReactNode
    footer?: ReactNode
    className?: string
    contentClassName?: string
  }) => open
    ? <div role="dialog" className={className} aria-label={title}><h2>{title}</h2><div className={contentClassName}>{children}</div>{footer}</div>
    : null
  const icon = () => null
  return {
    Button,
    Input,
    Modal,
    Pill: ({ active: _active, children, ...props }: { active?: boolean; children?: ReactNode; [key: string]: unknown }) => (
      props.onClick === undefined ? <span>{children}</span> : <button {...props}>{children}</button>
    ),
    StateDot: ({ state }: { state: string }) => <span data-state={state} />,
    Tooltip: passthrough,
    IconCheckOutline16: icon,
    IconChevronDownOutline14: icon,
    IconChevronUpOutline14: icon,
    IconCloseOutline16: icon,
    IconCordisPluginOutline14: icon,
    IconDataOutline16: icon,
    IconDownloadOutline16: icon,
    IconPlayOutline16: icon,
    IconGlobeOutline14: icon,
    IconLoadingOutline16: icon,
    IconPlusOutline16: icon,
    IconRefreshOutline16: icon,
    IconRightUpOutline16: icon,
    IconSearchOutline16: icon,
    IconSettingsOutline16: icon,
    IconTrashOutline16: icon,
    IconWarningOutline16: icon,
  }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const t = ((key: string) => key) as PropsLocale<'community-market'>['t']

function renderOpenOverlay() {
  const instance = createMarketViewStore().create()
  const useStore = <T,>(selector: (state: { open: boolean }) => T): T => useSyncExternalStore(
    instance.subscribe,
    () => selector(instance.getSnapshot()),
  )
  const props = {
    actions: instance.actions,
    useStore,
    readLocale: () => 'en',
    initialView: 'discover',
    t,
  } as unknown as MarketOverlayProps
  const rendered = render(<MarketOverlay {...props} />)
  act(() => { instance.actions.open() })
  return { ...rendered, instance }
}

describe('IPZSK market overlay', () => {
  it('opens the approved catalog directly and closes with Escape', async () => {
    vi.stubGlobal('fetch', async (url: string) => { expect(url).toBe('/api/ipzsk-market/catalog'); return new Response(JSON.stringify({plugins:[]})) })
    renderOpenOverlay(); expect(await screen.findByText('暂无已上架插件。')).toBeTruthy()
    fireEvent.keyDown(document,{key:'Escape'}); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
  it('shows the independently published plugin and GitHub source',async()=>{
    vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({plugins:[{id:'p',release_id:'r',name:'IPZSK 生图',repository:'JayceHuang/dsh-imagegen',version:'1.6.0',notes:'独立更新'}]})))
    renderOpenOverlay();await screen.findByText('IPZSK 生图');expect(screen.getByRole('link',{name:'GitHub 源码 ↗'}).getAttribute('href')).toBe('https://github.com/JayceHuang/dsh-imagegen')
  })
})
