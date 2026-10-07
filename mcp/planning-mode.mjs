export const PLANNING_MODES = ['explicit', 'ask', 'assisted'];

export function resolvePlanningMode(name, planningMode, assumptions = []) {
  if (!['pump_room.build','pump_room.route'].includes(name)) return { mode: planningMode || 'explicit', assumptions: [], requiresClarification: false };
  const mode = planningMode || 'ask';
  if (!PLANNING_MODES.includes(mode)) throw new Error(`Unknown planningMode '${mode}'.`);
  if (mode === 'ask') return {
    mode,
    assumptions: [],
    requiresClarification: true,
    questions: [
      '请明确设备/族类型和接口；如果使用当前模型中的现有设备，请允许助手读取并匹配。',
      '请明确管径、系统类型、标高和供水/回水意图。',
      '请明确起点/终点或允许助手提出候选路线；如需净距筛查，请提供毫米数或允许使用开发初筛值。'
    ]
  };
  if (mode === 'assisted' && assumptions.length === 0) throw new Error('assumptions_required: assisted planning must list its model/design assumptions before preview.');
  return {
    mode,
    assumptions: [...assumptions],
    requiresClarification: false,
    candidateOnly: mode === 'assisted',
    reviewNote: mode === 'assisted' ? '这是基于当前模型和列出的假设生成的候选方案，不是自动确认的工程设计。' : '需求来自用户明确约束；仍需审阅预览。'
  };
}
