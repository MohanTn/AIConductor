/**
 * ServiceBase — shared base class injected with DatabaseHandler and WorkflowValidator.
 * All domain service classes extend this to gain access to infrastructure dependencies.
 */
import { DatabaseHandler } from '../DatabaseHandler.js';
import { WorkflowValidator } from '../WorkflowValidator.js';

export abstract class ServiceBase {
  constructor(
    protected readonly db: DatabaseHandler,
    protected readonly validator: WorkflowValidator
  ) {}
}
