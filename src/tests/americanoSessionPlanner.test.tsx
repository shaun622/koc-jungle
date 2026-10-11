import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AmericanoSessionPlanner } from '@/components/americano/AmericanoSessionPlanner';
import { defaultAmericanoConfigV3 } from '@/logic/americanoV3/scoring';
import type { SessionPlanV3 } from '@/logic/americanoV3/types';

function Planner({ initial, entrants = 8 }: { initial?: SessionPlanV3; entrants?: number }) {
  const [plan, setPlan] = useState(initial);
  return <AmericanoSessionPlanner config={{ ...defaultAmericanoConfigV3('rotating'), sessionPlan: plan }} entrants={entrants} courts={2} startsAt="" onChange={setPlan}/>;
}

describe('simple time planner', () => {
  it('asks for one time and calculates the other in both directions', () => {
    render(<Planner/>);
    fireEvent.click(screen.getByLabelText(/Plan around session time/));
    expect(screen.getByLabelText('Session duration')).toBeInTheDocument();
    expect(screen.queryByLabelText('Minutes per round')).not.toBeInTheDocument();
    expect(screen.getByText('Suggested: 7 rounds · 15 minutes per round')).toBeInTheDocument();
    expect(screen.getByText(/Approximately 1h 57m/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Which time do you know?'), { target: { value: 'round' } });
    expect(screen.queryByLabelText('Session duration')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Minutes per round')).toHaveValue(10);
    expect(screen.getByText(/Approximately 1h 22m/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Minutes per round'), { target: { value: '15' } });
    expect(screen.getByText(/Approximately 1h 57m/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Adjust', { exact: true }));
    fireEvent.click(screen.getByLabelText(/Choose number of rounds/));
    fireEvent.change(screen.getByLabelText('Number of rounds'), { target: { value: '5' } });
    expect(screen.getByText(/Approximately 1h 23m/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Changeover minutes between rounds'), { target: { value: '0' } });
    expect(screen.getByText(/Approximately 1h 15m/)).toBeInTheDocument();
  });
  it('preserves previous two-input plans until the organizer explicitly changes mode', () => {
    render(<Planner initial={{ totalMinutes: 120, preference: 'round-length', roundMinutes: 10, changeoverMinutes: 2 }}/>);
    expect(screen.getByText(/Suggested: 10 rounds/)).toBeInTheDocument();
    expect(screen.getByText(/Your saved plan is unchanged/)).toBeInTheDocument();
    expect(screen.getByLabelText('Minutes per round')).toHaveValue(10);
    fireEvent.change(screen.getByLabelText('Which time do you know?'), { target: { value: 'session' } });
    expect(screen.getByText(/Suggested: 7 rounds/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Minutes per round')).not.toBeInTheDocument();
  });
  it('restores the reverse choice and handles an empty roster without a fictional estimate', () => {
    render(<Planner entrants={0} initial={{ totalMinutes: 82, preference: 'full', calculateFrom: 'round', roundMinutes: 10, changeoverMinutes: 2 }}/>);
    expect(screen.getByLabelText('Which time do you know?')).toHaveValue('round');
    expect(screen.queryByLabelText('Session duration')).not.toBeInTheDocument();
    expect(screen.getByText(/Add at least 4 players/)).toBeInTheDocument();
    expect(screen.queryByText(/Approximately/)).not.toBeInTheDocument();
  });
});
