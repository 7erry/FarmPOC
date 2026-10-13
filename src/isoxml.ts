/** shortcut: illustrative TASKDATA fragment, not a display-ready ISO 11783 file. */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

export function buildTaskDataXml(input: {
  taskName: string;
  fieldName: string;
  vehicleName: string;
  operationType: string;
}): string {
  const description = `${input.operationType} on ${input.fieldName} for ${input.vehicleName}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<ISO11783_TaskData VersionMajor="4" VersionMinor="3" DataTransferOrigin="1" ManagementSoftwareManufacturer="FarmENGAGE-PoC" ManagementSoftwareVersion="0.1">
  <TSK A="TSK1" B="${escapeXml(input.taskName)}" C="1" G="1" DES="${escapeXml(description)}"/>
</ISO11783_TaskData>
`;
}
