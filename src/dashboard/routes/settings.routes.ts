/**
 * Settings routes - Role Prompts configuration CRUD
 */
import { Router, Request, Response } from 'express';
import { AIConductor } from '../../AIConductor.js';
import { PipelineRole } from '../../types.js';
import { asyncHandler, ValidationError } from '../middleware/errorHandler.js';

const VALID_ROLES: PipelineRole[] = [
  'productDirector',
  'architect',
  'uiUxExpert',
  'securityOfficer',
  'developer',
  'codeReviewer',
  'qa',
];

const MAX_SYSTEM_PROMPT_LENGTH = 10_000;
const MAX_FIELD_LENGTH = 2_000;

const VALID_CLI_TOOLS = ['claude', 'copilot'];
const MIN_CRON_INTERVAL = 30;
const MAX_CRON_INTERVAL = 3600;

function isValidRole(roleId: string): roleId is PipelineRole {
  return VALID_ROLES.includes(roleId as PipelineRole);
}

export function createSettingsRoutes(reviewManager: AIConductor): Router {
  const router = Router();

  /**
   * GET /api/settings/role-prompts
   * Returns all 7 role prompt configs from the database.
   */
  router.get('/settings/role-prompts', asyncHandler((_req: Request, res: Response) => {
    const prompts = reviewManager.getAllRolePrompts();
    res.json({ success: true, rolePrompts: prompts });
  }));

  /**
   * GET /api/settings/role-prompts/:roleId
   * Returns the prompt config for one role.
   */
  router.get('/settings/role-prompts/:roleId', asyncHandler((req: Request, res: Response) => {
    const roleId = req.params['roleId'] as string;
    if (!isValidRole(roleId)) throw new ValidationError(`Invalid roleId: ${roleId}`);
    const prompt = reviewManager.getRolePrompt(roleId);
    res.json({ success: true, roleId, ...prompt });
  }));

  /**
   * PUT /api/settings/role-prompts/:roleId
   * Updates one or more fields of a role's prompt config.
   * Body: { systemPrompt?, focusAreas?, researchInstructions?, requiredOutputFields? }
   */
  router.put('/settings/role-prompts/:roleId', asyncHandler((req: Request, res: Response) => {
    const roleId = req.params['roleId'] as string;
    if (!isValidRole(roleId)) throw new ValidationError(`Invalid roleId: ${roleId}`);

    const { systemPrompt, focusAreas, researchInstructions, requiredOutputFields } = req.body;

    if (systemPrompt !== undefined && systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH) {
      throw new ValidationError(`systemPrompt exceeds max length of ${MAX_SYSTEM_PROMPT_LENGTH} chars`);
    }
    if (researchInstructions !== undefined && researchInstructions.length > MAX_FIELD_LENGTH) {
      throw new ValidationError(`researchInstructions exceeds max length of ${MAX_FIELD_LENGTH} chars`);
    }
    if (focusAreas !== undefined && !Array.isArray(focusAreas)) {
      throw new ValidationError('focusAreas must be an array of strings');
    }
    if (requiredOutputFields !== undefined && !Array.isArray(requiredOutputFields)) {
      throw new ValidationError('requiredOutputFields must be an array of strings');
    }

    reviewManager.updateRolePrompt(roleId, { systemPrompt, focusAreas, researchInstructions, requiredOutputFields });
    const updated = reviewManager.getRolePrompt(roleId);
    res.json({ success: true, roleId, ...updated });
  }));

  /**
   * POST /api/settings/role-prompts/:roleId/reset
   * Resets a role's prompt to the built-in static default.
   */
  router.post('/settings/role-prompts/:roleId/reset', asyncHandler((req: Request, res: Response) => {
    const roleId = req.params['roleId'] as string;
    if (!isValidRole(roleId)) throw new ValidationError(`Invalid roleId: ${roleId}`);
    const defaults = reviewManager.resetRolePrompt(roleId);
    res.json({ success: true, roleId, ...defaults });
  }));

  // ─────────────────────────────────────────────────────────────────────
  // Queue & Worker Settings
  // ─────────────────────────────────────────────────────────────────────

  /**
   * GET /api/settings/queue
   * Returns all queue-related settings.
   */
  router.get('/settings/queue', asyncHandler((_req: Request, res: Response) => {
    const settings = reviewManager.getQueueSettings();
    res.json({ success: true, ...settings });
  }));

  /**
   * PUT /api/settings/queue
   * Updates one or more queue settings.
   * Body: { cronIntervalSeconds?, baseReposFolder?, cliTool?, workerEnabled?, devWorkflowScript? }
   */
  router.put('/settings/queue', asyncHandler((req: Request, res: Response) => {
    const { cronIntervalSeconds, baseReposFolder, cliTool, workerEnabled, devWorkflowScript } = req.body;

    if (cronIntervalSeconds !== undefined) {
      const val = Number(cronIntervalSeconds);
      if (!Number.isInteger(val) || val < MIN_CRON_INTERVAL || val > MAX_CRON_INTERVAL) {
        throw new ValidationError(`cronIntervalSeconds must be an integer between ${MIN_CRON_INTERVAL} and ${MAX_CRON_INTERVAL}`);
      }
    }
    if (cliTool !== undefined && !VALID_CLI_TOOLS.includes(cliTool)) {
      throw new ValidationError(`cliTool must be one of: ${VALID_CLI_TOOLS.join(', ')}`);
    }
    if (baseReposFolder !== undefined && typeof baseReposFolder !== 'string') {
      throw new ValidationError('baseReposFolder must be a string');
    }
    if (workerEnabled !== undefined && typeof workerEnabled !== 'boolean') {
      throw new ValidationError('workerEnabled must be a boolean');
    }
    if (devWorkflowScript !== undefined && typeof devWorkflowScript !== 'string') {
      throw new ValidationError('devWorkflowScript must be a string');
    }

    const updates: Record<string, any> = {};
    if (cronIntervalSeconds !== undefined) updates.cronIntervalSeconds = Number(cronIntervalSeconds);
    if (baseReposFolder !== undefined) updates.baseReposFolder = baseReposFolder;
    if (cliTool !== undefined) updates.cliTool = cliTool;
    if (workerEnabled !== undefined) updates.workerEnabled = workerEnabled;
    if (devWorkflowScript !== undefined) updates.devWorkflowScript = devWorkflowScript;

    reviewManager.updateQueueSettings(updates);
    const updated = reviewManager.getQueueSettings();
    res.json({ success: true, ...updated });
  }));

  return router;
}
