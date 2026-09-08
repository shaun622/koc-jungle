import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import { useApplyTheme } from '@/hooks/useApplyTheme';
import { useThemeStore } from '@/store/theme';
import { useEventStore } from '@/store/eventStore';
import { TvStandings, standingsPageSize } from '@/components/TvStandings';
import { EventNightTimer, visibleRoundSteps } from '@/components/EventNightTimer';
import { buildDemoEvent } from '@/logic/demoData';

function ThemedScreen() { useApplyTheme(); return <ThemeSwitch />; }
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('approved appearance and event-night presentation', () => {
  it('applies and saves one preference without changing event data', () => {
    const event = useEventStore.getState().event;
    render(<ThemedScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(localStorage.getItem('koc-theme-v1')!).state.preference).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(useThemeStore.getState().preference).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(useEventStore.getState().event).toBe(event);
  });
  it('balances standings pages without dropping entries or dividing by zero', () => {
    expect(standingsPageSize(24, 10)).toBe(8);
    expect(standingsPageSize(16, 10)).toBe(8);
    expect(standingsPageSize(6, 10)).toBe(6);
    expect(standingsPageSize(0, 0)).toBe(1);
  });
  it('makes every team beyond the old 14-team limit reachable, without changing rankings', () => {
    const event = buildDemoEvent();
    event.teams = Array.from({ length: 24 }, (_, i) => ({ ...event.teams[i % 14], id:`team-${i}`, name:`Pair ${i + 1}` }));
    const snapshot = JSON.stringify(event);
    render(<TvStandings event={event} subtitle="Pre-round" />);
    const names = new Set<string>();
    for (let page = 0; page < 3; page++) {
      document.querySelectorAll('.tv-lb-name-col>span:first-child').forEach(node => names.add(node.textContent!));
      fireEvent.click(screen.getByRole('button', { name:'Next standings page' }));
    }
    expect(names.size).toBe(24);
    expect(JSON.stringify(event)).toBe(snapshot);
  });
  it('rotates pages every eight seconds and supports pausing', () => {
    render(<TvStandings event={buildDemoEvent()} subtitle="Pre-round" />);
    expect(screen.getByText('1–7 of 14 teams')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(8000));
    expect(screen.getByText('8–14 of 14 teams')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name:'Pause standings rotation' }));
    act(() => vi.advanceTimersByTime(16000));
    expect(screen.getByText('8–14 of 14 teams')).toBeInTheDocument();
  });
  it('keeps the current round in a bounded progress indicator', () => {
    expect(visibleRoundSteps(3, 6)).toEqual([1,2,3,4,5,6]);
    expect(visibleRoundSteps(19, 20)).toEqual([15,16,17,18,19,20]);
    expect(visibleRoundSteps(1, 1)).toEqual([1]);
  });
  it('preserves overdue/warning state and does not invent a next round after the final', () => {
    render(<EventNightTimer timer={{ remainingMs:-1000,isRunning:true,isPaused:false,hasStarted:true,hasFinished:true }} roundIndex={6} totalRounds={6} durationMs={1200000} warningAtMs={60000} hasRound />);
    expect(screen.getByText('Time’s up')).toBeInTheDocument();
    expect(screen.getByText('Final round')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveClass('danger');
    expect(document.querySelector('.tv-timer-progress-bar')).toHaveStyle({ width:'0%' });
    expect(screen.queryByText('Round 7')).not.toBeInTheDocument();
  });
});
