import { assertWorkflowEnabled, getWorkflow, listWorkflows } from './workflow-registry.mjs';
import { workflowOperations } from './workflows.mjs';

export function buildRegisteredWorkflow(workflowId, input = {}) {
  const workflow = assertWorkflowEnabled(workflowId);
  if(workflow.destructiveLevel==='read-only'){const error=new Error('Read-only workflows use a read adapter, not a modeling operation builder.');error.code='workflow_read_only';throw error;}
  return { workflow, operations: workflowOperations(workflowId, input) };
}

export function registryPreviewMetadata(workflowId) {
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error("Unknown registered workflow '" + workflowId + "'.");
  return { workflowId: workflow.workflowId, domain: workflow.domain, acceptanceStatus: workflow.acceptanceStatus, planningModes: [...workflow.planningModes] };
}

export function registrySnapshot() { return listWorkflows(); }
