const MERMAID_MARKERS = [
    'graph ', 'flowchart ', 'sequenceDiagram', 'classDiagram',
    'stateDiagram', 'stateDiagram-v2', 'erDiagram', 'gantt',
    'pie', 'journey', 'requirementDiagram', 'gitgraph',
    'mindmap', 'timeline', 'zenuml', 'sankey-beta',
    'xychart', 'block-beta', 'kanban', 'quadrantChart',
    'packet-beta', 'c4',
];

function sanitizeMermaidCode(code) {
    return code.replace(/\[([^\[\]]*\([^\[\]]*\)[^\[\]]*)\]/g, '["$1"]');
}

export function extractMermaidCode(text) {
    if (!text) return '';
    const trimmed = text.trim();
    const codeBlock = trimmed.match(/```mermaid\s*\n?([\s\S]*?)```/);
    if (codeBlock) return sanitizeMermaidCode(codeBlock[1].trim());
    const lines = trimmed.split('\n');
    const startIdx = lines.findIndex(l => MERMAID_MARKERS.some(m => l.trim().startsWith(m)));
    if (startIdx === -1) return sanitizeMermaidCode(trimmed);
    const diagramLines = lines.slice(startIdx);
    const endIdx = diagramLines.findIndex((l, i) =>
        i > 0 && !l.trim() && (i + 1 >= diagramLines.length || !diagramLines[i + 1].trim())
    );
    const extracted = (endIdx > 0 ? diagramLines.slice(0, endIdx + 1) : diagramLines).join('\n').trim();
    return sanitizeMermaidCode(extracted);
}
