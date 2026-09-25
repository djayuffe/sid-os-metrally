
import { ParsedTrace, TrackerProject } from '../types';

export const exportTraceToJson = (traceData: ParsedTrace | null) => {
    if (!traceData) return;
    const b = new Blob([JSON.stringify(traceData, null, 2)], { type: 'application/json' });
    const u = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = u;
    a.download = 'sid_trace.json';
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(u), 1000);
};

export const exportProjectToJson = (trackerProject: TrackerProject | undefined) => {
    if (!trackerProject) return;
    const b = new Blob([JSON.stringify(trackerProject, null, 2)], { type: 'application/json' });
    const u = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = u;
    a.download = 'project.sng.json';
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(u), 1000);
};
