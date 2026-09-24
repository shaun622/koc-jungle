import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import { useApplyTheme } from '@/hooks/useApplyTheme';
import { useThemeStore } from '@/store/theme';
import { useEventStore } from '@/store/eventStore';
import { leaderboard } from '@/store/selectors';
import { TvStandings } from '@/components/TvStandings';
import { EventNightTimer, visibleRoundSteps } from '@/components/EventNightTimer';
import { buildDemoEvent } from '@/logic/demoData';
import { MemoryRouter } from 'react-router-dom';
import { HelpScreen } from '@/routes/HelpScreen';

function ThemedScreen() { useApplyTheme(); return <ThemeSwitch />; }
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('approved appearance and event-night presentation', () => {
  it('inherits the active theme on Help without rendering another theme switch', () => {
    useThemeStore.setState({ preference: 'dark' });
    render(<MemoryRouter><HelpScreen /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: 'Light' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dark' })).not.toBeInTheDocument();
    expect(useThemeStore.getState().preference).toBe('dark');
  });
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
  it('handles empty standings without pagination', () => {
    const event = buildDemoEvent();
    event.teams = [];
    render(<TvStandings event={event} subtitle="Pre-round" />);
    expect(screen.getByText('No teams yet.')).toBeInTheDocument();
    expect(screen.getByText('0 teams')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('shows every team beyond the old 14-team limit at once without changing rankings', () => {
    const event = buildDemoEvent();
    event.teams = Array.from({ length: 24 }, (_, i) => ({ ...event.teams[i % 14], id:`team-${i}`, name:`Pair ${i + 1}` }));
    const snapshot = JSON.stringify(event);
    render(<TvStandings event={event} subtitle="Pre-round" />);
    const names = new Set([...document.querySelectorAll('.tv-lb-name-col>span:first-child')].map(node => node.textContent));
    expect(names.size).toBe(24);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(JSON.stringify(event)).toBe(snapshot);
  });
  it('keeps every standing on screen instead of rotating pages', () => {
    render(<TvStandings event={buildDemoEvent()} subtitle="Pre-round" />);
    const before = [...document.querySelectorAll('.tv-lb-name-col>span:first-child')].map(node => node.textContent);
    expect(before).toHaveLength(14);
    act(() => vi.advanceTimersByTime(24000));
    expect([...document.querySelectorAll('.tv-lb-name-col>span:first-child')].map(node => node.textContent)).toEqual(before);
    expect(screen.getByText('14 teams')).toBeInTheDocument();
  });
  it('uses the fitted KoC standings for old events with no format field', () => {
    const event = buildDemoEvent();
    delete event.format;
    event.teams[0].name = 'Legacy Centre Crew';
    const snapshot = JSON.stringify(event);
    const { container } = render(<TvStandings event={event} subtitle="Pre-round" />);
    expect(container.querySelector('.tv-standings')).toHaveClass('tv-standings--fit');
    expect(container.querySelectorAll('.tv-lb-row')).toHaveLength(event.teams.length);
    expect(screen.getByText('Legacy Centre Crew')).toBeInTheDocument();
    expect(screen.getByText('Jon & Sven')).toHaveClass('tv-lb-players');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(event).not.toHaveProperty('format');
    expect(JSON.stringify(event)).toBe(snapshot);
  });
  it.each([32, 64])('preserves paginated, rotating and pausable Americano standings for %i teams', (count) => {
    const event = buildDemoEvent();
    event.format = 'americano';
    event.teams = Array.from({ length: count }, (_, index) => ({
      ...event.teams[index % 14], id: `americano-team-${index}`, name: `Pair ${index + 1}`,
    }));
    const snapshot = JSON.stringify(event);
    const { container } = render(<TvStandings event={event} subtitle="Pre-round" />);
    expect(container.querySelector('.tv-standings')).not.toHaveClass('tv-standings--fit');
    expect(screen.getByText(`1–8 of ${count} teams`)).toBeInTheDocument();
    const names = new Set<string | null>();
    for (let page = 0; page < count / 8; page += 1) {
      const visible = [...container.querySelectorAll('.tv-lb-name-col>span:first-child')];
      expect(visible).toHaveLength(8);
      visible.forEach(node => names.add(node.textContent));
      fireEvent.click(screen.getByRole('button', { name: 'Next standings page' }));
    }
    expect(names.size).toBe(count);
    expect(screen.getByText(`1–8 of ${count} teams`)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(8000));
    expect(screen.getByText(`9–16 of ${count} teams`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pause standings rotation' }));
    act(() => vi.advanceTimersByTime(24000));
    expect(screen.getByText(`9–16 of ${count} teams`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume standings rotation' })).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.stringify(event)).toBe(snapshot);
  });
  it('shows both full player names on the second identity line for a custom team name', () => {
    const event = buildDemoEvent();
    event.teams = [event.teams[0]];
    event.teams[0].name = 'Centre Court Crew';
    event.teams[0].players[0].name = 'Alexandra Montgomery';
    event.teams[0].players[1].name = 'Christopher Wellington';
    const snapshot = JSON.stringify(event);
    const { container } = render(<TvStandings event={event} subtitle="Pre-round" />);
    const identity = container.querySelector('.tv-lb-name-col')!;
    expect(identity.children[0]).toHaveTextContent(/^Centre Court Crew$/);
    expect(identity.children[1]).toHaveClass('tv-lb-players');
    expect(identity.children[1]).toHaveTextContent(/^Alexandra Montgomery & Christopher Wellington$/);
    expect(JSON.stringify(event)).toBe(snapshot);
  });
  it.each([
    { name: undefined, label: 'Jon & Sven' },
    { name: '', label: 'Jon & Sven' },
    { name: '   ', label: 'Jon & Sven' },
    { name: 'Jon & Sven', label: 'Jon & Sven' },
    { name: '  JON & sVen  ', label: 'JON & sVen' },
  ])('shows the player pair only once when the team name is $name', ({ name, label }) => {
    const event = buildDemoEvent();
    event.teams = [{ ...event.teams[0], name }];
    const { container } = render(<TvStandings event={event} subtitle="Pre-round" />);
    expect(screen.getAllByText(/^Jon & Sven$/i)).toHaveLength(1);
    expect(container.querySelector('.tv-lb-team-label')).toHaveTextContent(label);
    expect(container.querySelector('.tv-lb-players')).not.toBeInTheDocument();
  });
  it('refreshes team and player names after a rename without changing scores, ranks, or event state', () => {
    const event = buildDemoEvent();
    event.format = 'koc';
    event.teams = [
      { ...event.teams[0], name: 'Zulu Crew' },
      { ...event.teams[1], name: 'Alpha Club' },
    ];
    event.rounds = [{
      id: 'completed-round', index: 1, durationMs: 1200000, totalPausedMs: 0, completedAt: 1,
      matches: [{
        id: 'completed-match', courtId: event.courts[0].id,
        teamAId: event.teams[0].id, teamBId: event.teams[1].id,
        scoreA: 6, scoreB: 4, status: 'completed', pointValueAtTime: 9,
      }],
    }];
    const snapshot = JSON.stringify(event);
    const standings = leaderboard(event);
    const { container, rerender } = render(<TvStandings event={event} subtitle="Round 1 complete" />);
    const presentation = () => [...container.querySelectorAll('.tv-lb-row')].map(row => ({
      rank: row.querySelector('.rank')?.innerHTML,
      points: row.querySelector('.pts')?.textContent,
      games: row.querySelector('.tv-lb-games')?.textContent,
      isLeader: row.classList.contains('king'),
    }));
    const before = presentation();
    expect(before.map(row => row.points)).toEqual(['9', '0']);
    expect(before.map(row => row.isLeader)).toEqual([true, false]);

    const renamed = structuredClone(event);
    renamed.teams[0].name = 'Beta Crew';
    renamed.teams[0].players[0].name = 'Alexandra Montgomery';
    renamed.teams[0].players[1].name = 'Christopher Wellington';
    renamed.teams[1].name = undefined;
    renamed.teams[1].players[0].name = 'Danielle Henderson';
    renamed.teams[1].players[1].name = 'Benjamin Richardson';
    const renamedSnapshot = JSON.stringify(renamed);
    rerender(<TvStandings event={renamed} subtitle="Round 1 complete" />);

    expect([...container.querySelectorAll('.tv-lb-team-label')].map(node => node.textContent))
      .toEqual(['Beta Crew', 'Danielle Henderson & Benjamin Richardson']);
    expect(screen.getByText('Alexandra Montgomery & Christopher Wellington')).toHaveClass('tv-lb-players');
    expect(screen.getAllByText('Danielle Henderson & Benjamin Richardson')).toHaveLength(1);
    expect(screen.queryByText('Zulu Crew')).not.toBeInTheDocument();
    expect(screen.queryByText('Alpha Club')).not.toBeInTheDocument();
    expect(screen.queryByText('Jon & Sven')).not.toBeInTheDocument();
    expect(screen.queryByText('Chris DH & William')).not.toBeInTheDocument();
    expect(presentation()).toEqual(before);
    expect(leaderboard(renamed)).toEqual(standings);
    expect(JSON.stringify(event)).toBe(snapshot);
    expect(JSON.stringify(renamed)).toBe(renamedSnapshot);
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
