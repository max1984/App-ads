// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import App from '../App.jsx'

beforeEach(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false }))
  // Node 25 ships an incomplete global localStorage that shadows jsdom's — use an in-memory stub.
  const store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

const typeInput = (text) =>
  fireEvent.change(screen.getByLabelText('app-ads.txt input'), { target: { value: text } })

describe('App', () => {
  it('shows the empty state before any input', () => {
    render(<App />)
    expect(screen.getByText('Cleaned output appears here')).toBeTruthy()
  })

  it('validates on Validate click and shows cleaned output with a health badge', () => {
    render(<App />)
    typeInput('OWNERDOMAIN=example.com\nGoogle.com, pub-1, direct')
    fireEvent.click(screen.getByRole('button', { name: /Validate/ }))
    expect(screen.getByLabelText('Cleaned output').value)
      .toBe('OWNERDOMAIN=example.com\ngoogle.com, pub-1, DIRECT, f08c47fec0942fa0')
    expect(screen.getByTitle(/File quality score/).textContent).toBe('A100')
  })

  it('offers an Apply fix for cert mismatches and applies it', () => {
    render(<App />)
    typeInput('OWNERDOMAIN=example.com\ngoogle.com, pub-1, DIRECT, c3e20eee3f780d68')
    fireEvent.click(screen.getByRole('button', { name: /Validate/ }))
    fireEvent.click(screen.getAllByRole('button', { name: /Apply fix/i })[0])
    expect(screen.getByLabelText('app-ads.txt input').value)
      .toBe('OWNERDOMAIN=example.com\ngoogle.com, pub-1, DIRECT, f08c47fec0942fa0')
  })

  it('ignores a stale Apply fix click if the input shifted before the debounced re-validation caught up', () => {
    vi.useFakeTimers()
    render(<App />)
    typeInput('OWNERDOMAIN=example.com\ngoogle.com, pub-1, DIRECT, c3e20eee3f780d68')
    act(() => { vi.advanceTimersByTime(300) })
    const applyBtn = screen.getAllByRole('button', { name: /Apply fix/i })[0]

    // Edit again, inserting a line before the issue — debounce is now pending,
    // so the Apply fix button above still reflects the stale pre-edit text.
    const shifted = 'OWNERDOMAIN=example.com\nNEW LINE\ngoogle.com, pub-1, DIRECT, c3e20eee3f780d68'
    typeInput(shifted)
    fireEvent.click(applyBtn)

    expect(screen.getByLabelText('app-ads.txt input').value).toBe(shifted)
  })

  it('does not let a pending debounced validation repopulate the output after Clear', () => {
    vi.useFakeTimers()
    render(<App />)
    // handleInputChange's 300ms debounce is now pending (result is still
    // null — nothing has re-validated yet).
    typeInput('google.com, pub-1, DIRECT')
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    act(() => { vi.advanceTimersByTime(300) })

    expect(screen.getByLabelText('app-ads.txt input').value).toBe('')
    expect(screen.getByText('Cleaned output appears here')).toBeTruthy()
  })

  it('shows an inline message instead of alert() when the file is too large to share', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    render(<App />)
    typeInput('x'.repeat(80000))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Share' })) })
    expect(screen.getByText('⚠ Too large to share')).toBeTruthy()
    expect(alertSpy).not.toHaveBeenCalled()
  })
})

describe('App — accessibility', () => {
  it('exposes expanded state on collapsible toggles', () => {
    render(<App />)
    const batch = screen.getByRole('button', { name: /Batch URL check/ })
    expect(batch.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(batch)
    expect(batch.getAttribute('aria-expanded')).toBe('true')
  })

  it('renders a missing network coverage item as a real button, not a bare clickable div', () => {
    render(<App />)
    typeInput('google.com, pub-1, DIRECT')
    fireEvent.click(screen.getByRole('button', { name: /Validate/ }))
    fireEvent.click(screen.getByRole('button', { name: /Network Coverage/ }))
    // google.com is present (first in TOP_NETWORKS); appnexus.com is not —
    // only the missing ones are interactive (click to copy a template line).
    expect(screen.getByRole('button', { name: /AppNexus/ })).toBeTruthy()
  })
})

describe('App — gutter', () => {
  it('renders one line number per input line and highlights error lines', () => {
    const { container } = render(<App />)
    typeInput('OWNERDOMAIN=a.com\nfoo.com, 1\nbar.com, 2, DIRECT')
    fireEvent.click(screen.getByRole('button', { name: /Validate/ }))
    const inputGutter = container.querySelector('.gutter')
    expect([...inputGutter.children].map(d => d.textContent)).toEqual(['1', '2', '3'])
    expect(inputGutter.children[1].className).not.toBe('gutter-line ')
  })
})
