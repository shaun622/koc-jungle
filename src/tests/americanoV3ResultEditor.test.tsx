import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AmericanoResultEditorV3 } from '@/components/americano/AmericanoResultEditorV3';
import { addAmericanoParticipantV3, createAmericanoEventV3, previewAmericanoScheduleV3, startAmericanoEventV3 } from '@/logic/americanoV3/runtime';

describe('Americano score draft acknowledgements', () => {
  it('keeps entered scores through unrelated clock acknowledgements but accepts changed saved results', async () => {
    let event = createAmericanoEventV3('Draft test', 'rotating', 1);
    for (const name of ['Ari', 'Bo', 'Cam', 'Dee']) event = addAmericanoParticipantV3(event, name);
    event = startAmericanoEventV3(await previewAmericanoScheduleV3(event, { seed: 8 }));
    const match = event.rounds[0].matches[0];
    const onSave = vi.fn();
    const { rerender } = render(<AmericanoResultEditorV3 event={event} match={match} readOnly={false} correcting={false} onSave={onSave} />);
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '24' } });
    fireEvent.change(inputs[1], { target: { value: '0' } });
    rerender(<AmericanoResultEditorV3 event={{ ...structuredClone(event), revision: '4' }} match={structuredClone(match)} readOnly={false} correcting={false} onSave={onSave} />);
    expect(inputs[0]).toHaveValue(24);
    expect(inputs[1]).toHaveValue(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm result' }));
    expect(onSave).toHaveBeenCalledWith({ kind: 'rally', scoreA: 24, scoreB: 0 }, true);
    rerender(<AmericanoResultEditorV3 event={event} match={{ ...match, result: { kind: 'rally', scoreA: 12, scoreB: 12 } }} readOnly={false} correcting={false} onSave={onSave} />);
    expect(inputs[0]).toHaveValue(12);
    expect(inputs[1]).toHaveValue(12);
  });
});
