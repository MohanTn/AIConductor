/**
 * MCP tool definitions — name, description, and JSON input schemas.
 * Imported by index.ts for ListTools and AJV validation setup.
 */
export const TOOLS = [
  {
    name: 'get_next_step',
    description:
      'Get the next step in the task pipeline. Returns which role should act next, the system prompt for that role, allowed decisions, transition targets, focus areas, and context from previous reviews. This is the primary orchestration tool -- call this to determine what to do next for any task.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: {
          type: 'string',
          description: 'Repository name',
        },
        featureSlug: {
          type: 'string',
          description: 'Feature slug name',
        },
        taskId: {
          type: 'string',
          description: 'Unique task identifier (e.g., T01, T02)',
        },
      },
      required: ['repoName', 'featureSlug', 'taskId'],
    },
  },
  {
    name: 'add_stakeholder_review',
    description:
      'Add a stakeholder review to a task. Updates task status based on approval/rejection and enforces workflow state machine rules.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: {
          type: 'string',
          description: 'Repository name',
        },
        featureSlug: {
          type: 'string',
          description: 'Feature slug name',
        },
        taskId: {
          type: 'string',
          description: 'Unique task identifier (e.g., T01, T02)',
        },
        stakeholder: {
          type: 'string',
          enum: ['productDirector', 'architect', 'uiUxExpert', 'securityOfficer'],
          description: 'Stakeholder role performing the review',
        },
        decision: {
          type: 'string',
          enum: ['approve', 'reject'],
          description: 'Review decision (approve transitions forward, reject sends to NeedsRefinement)',
        },
        notes: {
          type: 'string',
          description: 'Review notes from the stakeholder',
        },
        additionalFields: {
          type: 'object',
          description: 'Role-specific additional fields',
          properties: {
            quickSummary: { type: 'string', description: 'Brief 1-2 sentence TL;DR of the review (Rec 6)' },
            marketAnalysis: { type: 'string' },
            competitorAnalysis: { type: 'string' },
            technologyRecommendations: { type: 'array', items: { type: 'string' } },
            designPatterns: { type: 'array', items: { type: 'string' } },
            usabilityFindings: { type: 'string' },
            accessibilityRequirements: { type: 'array', items: { type: 'string' } },
            userBehaviorInsights: { type: 'string' },
            securityRequirements: { type: 'array', items: { type: 'string' } },
            complianceNotes: { type: 'string' },
          },
        },
      },
      required: ['repoName', 'featureSlug', 'taskId', 'stakeholder', 'decision', 'notes'],
    },
  },
  {
    name: 'get_task_status',
    description:
      'Get the current status of a specific task including which stakeholders have reviewed it and what transitions are allowed.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: {
          type: 'string',
          description: 'Repository name',
        },
        featureSlug: {
          type: 'string',
          description: 'Feature slug name',
        },
        taskId: {
          type: 'string',
          description: 'Unique task identifier (e.g., T01, T02)',
        },
      },
      required: ['repoName', 'featureSlug', 'taskId'],
    },
  },
  {
    name: 'get_review_summary',
    description:
      'Generate a comprehensive summary of all tasks showing progress by status and stakeholder.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: {
          type: 'string',
          description: 'Repository name',
        },
        featureSlug: {
          type: 'string',
          description: 'Feature slug name',
        },
      },
      required: ['repoName', 'featureSlug'],
    },
  },
  {
    name: 'validate_workflow',
    description:
      'Validate if a stakeholder can perform a review on a task without modifying any data. Use this before calling add_stakeholder_review.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: {
          type: 'string',
          description: 'Repository name',
        },
        featureSlug: {
          type: 'string',
          description: 'Feature slug name',
        },
        taskId: {
          type: 'string',
          description: 'Unique task identifier (e.g., T01, T02)',
        },
        stakeholder: {
          type: 'string',
          enum: ['productDirector', 'architect', 'uiUxExpert', 'securityOfficer'],
          description: 'Stakeholder role to validate',
        },
      },
      required: ['repoName', 'featureSlug', 'taskId', 'stakeholder'],
    },
  },
  {
    name: 'transition_task_status',
    description:
      'Transition a task to a new status in the development workflow. Validates actor permissions and allowed transitions.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: {
          type: 'string',
          description: 'Repository name',
        },
        featureSlug: {
          type: 'string',
          description: 'Feature slug name',
        },
        taskId: {
          type: 'string',
          description: 'Unique task identifier (e.g., T01, T02)',
        },
        fromStatus: {
          type: 'string',
          description: 'Current task status (for validation)',
        },
        toStatus: {
          type: 'string',
          description: 'Target status to transition to',
        },
        actor: {
          type: 'string',
          enum: ['system', 'developer', 'codeReviewer', 'qa', 'productDirector', 'architect', 'uiUxExpert', 'securityOfficer'],
          description: 'Actor performing the transition',
        },
        notes: {
          type: 'string',
          description: 'Optional notes about the transition',
        },
        metadata: {
          type: 'object',
          description: 'Optional role-specific metadata for the transition',
          properties: {
            developerNotes: { type: 'string' },
            filesChanged: { type: 'array', items: { type: 'string' } },
            testFiles: { type: 'array', items: { type: 'string' } },
            docsUpdated: { type: 'array', items: { type: 'string' }, description: 'Documentation files that were updated' },
            documentationNotes: { type: 'string', description: 'Explanation of what documentation was updated and why' },
            codeReviewerNotes: { type: 'string' },
            testResultsSummary: { type: 'string' },
            codeQualityConcerns: { type: 'string' },
            qaNotes: { type: 'string' },
            bugsFound: { type: 'string' },
            deploymentReadiness: { type: 'string' },
            acceptanceCriteriaMet: { type: 'boolean' },
            testExecutionSummary: { type: 'string' },
          },
        },
      },
      required: ['repoName', 'featureSlug', 'taskId', 'fromStatus', 'toStatus', 'actor'],
    },
  },
  {
    name: 'get_next_task',
    description:
      'Get the next task to work on based on status filter and orderOfExecution. Returns the task with the lowest orderOfExecution value.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: {
          type: 'string',
          description: 'Repository name',
        },
        featureSlug: {
          type: 'string',
          description: 'Feature slug name',
        },
        statusFilter: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of task statuses to filter by (e.g., ["ReadyForDevelopment", "ToDo", "NeedsChanges"])',
        },
      },
      required: ['repoName', 'featureSlug', 'statusFilter'],
    },
  },
  {
    name: 'update_acceptance_criteria',
    description:
      'Mark an acceptance criterion as verified or unverified for a specific task.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: {
          type: 'string',
          description: 'Repository name',
        },
        featureSlug: {
          type: 'string',
          description: 'Feature slug name',
        },
        taskId: {
          type: 'string',
          description: 'Unique task identifier (e.g., T01, T02)',
        },
        criterionId: {
          type: 'string',
          description: 'Acceptance criterion ID (e.g., AC-1)',
        },
        verified: {
          type: 'boolean',
          description: 'Whether the criterion is verified (true) or not (false)',
        },
      },
      required: ['repoName', 'featureSlug', 'taskId', 'criterionId', 'verified'],
    },
  },
  {
    name: 'get_tasks_by_status',
    description:
      'Get all tasks that match a specific status.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: {
          type: 'string',
          description: 'Repository name',
        },
        featureSlug: {
          type: 'string',
          description: 'Feature slug name',
        },
        status: {
          type: 'string',
          description: 'Task status to filter by',
        },
      },
      required: ['repoName', 'featureSlug', 'status'],
    },
  },
  {
    name: 'verify_all_tasks_complete',
    description:
      'Verify if all tasks in a task file are marked as Done. Returns completion statistics.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: {
          type: 'string',
          description: 'Repository name',
        },
        featureSlug: {
          type: 'string',
          description: 'Feature slug name',
        },
      },
      required: ['repoName', 'featureSlug'],
    },
  },
  {
    name: 'create_feature',
    description:
      'Create a new feature. This is the first step before adding tasks. Creates a feature entry with a slug, display name, and optional description.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: {
          type: 'string',
          description: 'Repository name',
        },
        featureSlug: {
          type: 'string',
          description: 'URL-friendly feature slug (e.g., "smart-strangle-engine")',
        },
        featureName: {
          type: 'string',
          description: 'Human-readable feature name (e.g., "Smart Strangle Engine")',
        },
        description: {
          type: 'string',
          description: 'Plain-text description of the feature scope and objectives (max 10,000 chars)',
        },
        intention: {
          type: 'string',
          description: 'The higher-level goal or purpose this feature ultimately serves — the "why" behind the feature (e.g., "to enable authenticated API calls to the payment provider"). Max 2,000 chars.',
        },
      },
      required: ['repoName', 'featureSlug', 'featureName'],
    },
  },
  {
    name: 'update_feature',
    description:
      'Update an existing feature\'s name and/or description. Use after create_feature to enrich the feature record as refinement progresses.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: {
          type: 'string',
          description: 'Repository name',
        },
        featureSlug: {
          type: 'string',
          description: 'Feature slug to update',
        },
        featureName: {
          type: 'string',
          description: 'Updated human-readable feature name (optional)',
        },
        description: {
          type: 'string',
          description: 'Updated plain-text description of the feature scope and objectives (max 10,000 chars)',
        },
        intention: {
          type: 'string',
          description: 'Updated higher-level goal or purpose this feature ultimately serves (max 2,000 chars)',
        },
      },
      required: ['repoName', 'featureSlug'],
    },
  },
  {
    name: 'add_task',
    description:
      'Add a task to an existing feature. The task starts in PendingProductDirector status and proceeds through: Product Director > Architect > UI/UX Expert > Security Officer > Developer > Code Reviewer > QA > Done.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: {
          type: 'string',
          description: 'Repository name',
        },
        featureSlug: {
          type: 'string',
          description: 'Feature slug to add the task to',
        },
        taskId: {
          type: 'string',
          description: 'Unique task identifier (e.g., T01, T02)',
        },
        title: {
          type: 'string',
          description: 'Task title',
        },
        description: {
          type: 'string',
          description: 'Detailed task description',
        },
        orderOfExecution: {
          type: 'number',
          description: 'Execution order (1, 2, 3, etc.)',
        },
        acceptanceCriteria: {
          type: 'array',
          description: 'List of acceptance criteria',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Criterion ID (e.g., AC-1)' },
              criterion: { type: 'string', description: 'The acceptance criterion text' },
              priority: { type: 'string', enum: ['Must Have', 'Should Have', 'Could Have'] },
            },
            required: ['id', 'criterion', 'priority'],
          },
        },
        testScenarios: {
          type: 'array',
          description: 'List of test scenarios',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Scenario ID (e.g., TS-1)' },
              title: { type: 'string', description: 'Test scenario title' },
              description: { type: 'string', description: 'Test scenario description' },
              manualOnly: { type: 'boolean', description: 'Whether this test is manual only' },
              priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
            },
            required: ['id', 'title', 'description', 'priority'],
          },
        },
        outOfScope: {
          type: 'array',
          items: { type: 'string' },
          description: 'Items explicitly out of scope for this task',
        },
        estimatedHours: {
          type: 'number',
          description: 'Estimated hours to complete',
        },
        dependencies: {
          type: 'array',
          items: { type: 'string' },
          description: 'Task IDs this task depends on',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization',
        },
      },
      required: ['repoName', 'featureSlug', 'taskId', 'title', 'description', 'orderOfExecution'],
    },
  },
  {
    name: 'list_features',
    description:
      'List all features in a repository with their task counts and last modified timestamps.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: {
          type: 'string',
          description: 'Repository name',
        },
      },
      required: ['repoName'],
    },
  },
  {
    name: 'delete_feature',
    description:
      'Delete a feature and all its associated tasks, transitions, and reviews.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: {
          type: 'string',
          description: 'Repository name',
        },
        featureSlug: {
          type: 'string',
          description: 'Feature slug to delete',
        },
      },
      required: ['repoName', 'featureSlug'],
    },
  },
  {
    name: 'get_feature',
    description:
      'Get a complete feature with all its tasks, transitions, acceptance criteria, test scenarios, and stakeholder reviews.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: {
          type: 'string',
          description: 'Repository name',
        },
        featureSlug: {
          type: 'string',
          description: 'Feature slug name',
        },
      },
      required: ['repoName', 'featureSlug'],
    },
  },
  {
    name: 'update_task',
    description:
      'Update an existing task within a feature. Allows modifying task properties like title, description, acceptance criteria, test scenarios, etc. Use this when requirements change during refinement. Note: Cannot update task status - use transition_task_status for status changes.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: {
          type: 'string',
          description: 'Repository name',
        },
        featureSlug: {
          type: 'string',
          description: 'Feature slug',
        },
        taskId: {
          type: 'string',
          description: 'Task ID to update',
        },
        updates: {
          type: 'object',
          description: 'Fields to update',
          properties: {
            title: { type: 'string', description: 'Task title' },
            description: { type: 'string', description: 'Task description' },
            orderOfExecution: { type: 'number', description: 'Execution order' },
            estimatedHours: { type: 'number', description: 'Estimated hours' },
            acceptanceCriteria: {
              type: 'array',
              description: 'Acceptance criteria',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  criterion: { type: 'string' },
                  priority: { type: 'string', enum: ['Must Have', 'Should Have', 'Could Have'] },
                },
                required: ['id', 'criterion', 'priority'],
              },
            },
            testScenarios: {
              type: 'array',
              description: 'Test scenarios',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  description: { type: 'string' },
                  manualOnly: { type: 'boolean' },
                  priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
                },
                required: ['id', 'title', 'description', 'priority'],
              },
            },
            outOfScope: {
              type: 'array',
              description: 'Out of scope items',
              items: { type: 'string' },
            },
            dependencies: {
              type: 'array',
              description: 'Task dependencies',
              items: { type: 'string' },
            },
            tags: {
              type: 'array',
              description: 'Task tags',
              items: { type: 'string' },
            },
          },
        },
      },
      required: ['repoName', 'featureSlug', 'taskId', 'updates'],
    },
  },
  {
    name: 'delete_task',
    description:
      'Delete a task from a feature. This removes the task and all associated data (transitions, reviews, criteria). Use this when a task is no longer needed. Warning: This operation cannot be undone.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: {
          type: 'string',
          description: 'Repository name',
        },
        featureSlug: {
          type: 'string',
          description: 'Feature slug',
        },
        taskId: {
          type: 'string',
          description: 'Task ID to delete',
        },
      },
      required: ['repoName', 'featureSlug', 'taskId'],
    },
  },
  {
    name: 'register_repo',
    description:
      'Register a new repository. Creates a repo entry that acts as a namespace for all features and tasks. First step before creating features in a new repo.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: {
          type: 'string',
          description: 'Unique repository name (e.g., "aiconductor")',
        },
        repoPath: {
          type: 'string',
          description: 'Absolute path to repository root',
        },
        repoUrl: {
          type: 'string',
          description: 'Optional git repository URL',
        },
        defaultBranch: {
          type: 'string',
          description: 'Default branch name (defaults to "main")',
        },
        metadata: {
          type: 'object',
          description: 'Optional metadata as key-value pairs',
        },
      },
      required: ['repoName', 'repoPath'],
    },
  },
  {
    name: 'list_repos',
    description:
      'List all registered repositories with their feature and task counts.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_current_repo',
    description:
      'Get the current repository based on working directory. Auto-detects if current directory is a registered repo.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'update_refinement_step',
    description:
      'Update a refinement step for a feature. Used during the 8-step refinement workflow to track progress and store step data.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: {
          type: 'string',
          description: 'Repository name',
        },
        featureSlug: {
          type: 'string',
          description: 'Feature slug',
        },
        stepNumber: {
          type: 'number',
          description: 'Step number (1-8)',
        },
        completed: {
          type: 'boolean',
          description: 'Whether the step is completed',
        },
        summary: {
          type: 'string',
          description: 'Brief summary of what was accomplished in this step',
        },
        data: {
          type: 'object',
          description: 'Step-specific data as key-value pairs',
        },
      },
      required: ['repoName', 'featureSlug', 'stepNumber', 'completed', 'summary'],
    },
  },
  {
    name: 'add_feature_acceptance_criteria',
    description:
      'Add acceptance criteria at the feature level (before tasks are created). Used in Step 4 of refinement workflow.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: {
          type: 'string',
          description: 'Repository name',
        },
        featureSlug: {
          type: 'string',
          description: 'Feature slug',
        },
        criteria: {
          type: 'array',
          description: 'List of acceptance criteria',
          items: {
            type: 'object',
            properties: {
              criterionId: { type: 'string', description: 'Criterion ID (e.g., FAC-1)' },
              criterion: { type: 'string', description: 'The acceptance criterion text' },
              priority: { type: 'string', enum: ['Must Have', 'Should Have', 'Could Have'] },
              source: { type: 'string', description: 'Source of criterion (e.g., "generated", "user-provided")' },
            },
            required: ['criterionId', 'criterion', 'priority'],
          },
        },
      },
      required: ['repoName', 'featureSlug', 'criteria'],
    },
  },
  {
    name: 'add_feature_test_scenarios',
    description:
      'Add test scenarios at the feature level (before tasks are created). Used in Step 5 of refinement workflow.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: {
          type: 'string',
          description: 'Repository name',
        },
        featureSlug: {
          type: 'string',
          description: 'Feature slug',
        },
        scenarios: {
          type: 'array',
          description: 'List of test scenarios',
          items: {
            type: 'object',
            properties: {
              scenarioId: { type: 'string', description: 'Scenario ID (e.g., FTS-1)' },
              title: { type: 'string', description: 'Test scenario title' },
              description: { type: 'string', description: 'Test scenario description' },
              priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
              type: { type: 'string', description: 'Test type (e.g., "automated", "manual")' },
              preconditions: { type: 'string', description: 'Test preconditions' },
              expectedResult: { type: 'string', description: 'Expected test result' },
            },
            required: ['scenarioId', 'title', 'description', 'priority'],
          },
        },
      },
      required: ['repoName', 'featureSlug', 'scenarios'],
    },
  },
  {
    name: 'add_clarification',
    description:
      'Add a clarification question and optional answer. Used in Step 3 of refinement workflow to track questions that need user input.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: {
          type: 'string',
          description: 'Repository name',
        },
        featureSlug: {
          type: 'string',
          description: 'Feature slug',
        },
        question: {
          type: 'string',
          description: 'Clarification question',
        },
        answer: {
          type: 'string',
          description: 'Optional answer to the question',
        },
        askedBy: {
          type: 'string',
          enum: ['llm', 'user'],
          description: 'Who asked the question (defaults to "llm")',
        },
      },
      required: ['repoName', 'featureSlug', 'question'],
    },
  },
  {
    name: 'add_attachment_analysis',
    description:
      'Add analysis of an attachment (screenshot, document, etc.). Used in Step 2 of refinement workflow.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: {
          type: 'string',
          description: 'Repository name',
        },
        featureSlug: {
          type: 'string',
          description: 'Feature slug',
        },
        attachmentName: {
          type: 'string',
          description: 'Name of the attachment',
        },
        attachmentType: {
          type: 'string',
          enum: ['excel', 'image', 'document', 'design'],
          description: 'Type of attachment',
        },
        analysisSummary: {
          type: 'string',
          description: 'Summary of the analysis',
        },
        filePath: {
          type: 'string',
          description: 'Optional local file path',
        },
        fileUrl: {
          type: 'string',
          description: 'Optional URL to the file',
        },
        extractedData: {
          type: 'object',
          description: 'Optional extracted data as key-value pairs',
        },
      },
      required: ['repoName', 'featureSlug', 'attachmentName', 'attachmentType', 'analysisSummary'],
    },
  },
  {
    name: 'get_refinement_status',
    description:
      'Get comprehensive status of feature refinement including all steps, criteria, scenarios, and progress percentage.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: {
          type: 'string',
          description: 'Repository name',
        },
        featureSlug: {
          type: 'string',
          description: 'Feature slug',
        },
      },
      required: ['repoName', 'featureSlug'],
    },
  },
  {
    name: 'generate_refinement_report',
    description:
      'Generate a formatted report of the entire refinement process. Supports markdown, HTML, and JSON formats. Returns a complete summary ready for documentation.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: {
          type: 'string',
          description: 'Repository name',
        },
        featureSlug: {
          type: 'string',
          description: 'Feature slug',
        },
        format: {
          type: 'string',
          enum: ['markdown', 'html', 'json'],
          description: 'Output format (defaults to "markdown")',
        },
        outputPath: {
          type: 'string',
          description: 'Optional file path to save the report',
        },
        includeSections: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of sections to include (defaults to all: steps, criteria, scenarios, clarifications, attachments)',
        },
      },
      required: ['repoName', 'featureSlug'],
    },
  },
  {
    name: 'get_workflow_snapshot',
    description:
      'Get a compressed workflow snapshot for context efficiency. Returns feature summary, task snapshot with current roles, blockages, and AI-generated recommendations. Reduces context from ~50KB to ~5KB.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: {
          type: 'string',
          description: 'Repository name',
        },
        featureSlug: {
          type: 'string',
          description: 'Feature slug name',
        },
      },
      required: ['repoName', 'featureSlug'],
    },
  },
  {
    name: 'batch_transition_tasks',
    description:
      'Transition multiple tasks at once in a single operation. Validates all tasks, applies transitions atomically, and returns per-task results.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: {
          type: 'string',
          description: 'Repository name',
        },
        featureSlug: {
          type: 'string',
          description: 'Feature slug name',
        },
        taskIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Task IDs to transition (e.g., ["T01", "T02", "T03"])',
        },
        fromStatus: {
          type: 'string',
          description: 'Current status all tasks must have',
        },
        toStatus: {
          type: 'string',
          description: 'Target status to transition to',
        },
        actor: {
          type: 'string',
          enum: ['system', 'developer', 'codeReviewer', 'qa', 'productDirector', 'architect', 'uiUxExpert', 'securityOfficer'],
          description: 'Actor performing the transition',
        },
        notes: {
          type: 'string',
          description: 'Optional shared notes for all transitions',
        },
        metadata: {
          type: 'object',
          description: 'Optional shared metadata for all transitions (developer notes, files changed, etc.)',
        },
      },
      required: ['repoName', 'featureSlug', 'taskIds', 'fromStatus', 'toStatus', 'actor'],
    },
  },
  {
    name: 'batch_update_acceptance_criteria',
    description:
      'Mark multiple acceptance criteria as verified or unverified in a single batch operation across multiple tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: {
          type: 'string',
          description: 'Repository name',
        },
        featureSlug: {
          type: 'string',
          description: 'Feature slug name',
        },
        updates: {
          type: 'array',
          description: 'Array of acceptance criteria updates',
          items: {
            type: 'object',
            properties: {
              taskId: { type: 'string', description: 'Task ID (e.g., T01)' },
              criterionId: { type: 'string', description: 'Criterion ID (e.g., AC-1)' },
              verified: { type: 'boolean', description: 'Whether to mark as verified' },
            },
            required: ['taskId', 'criterionId', 'verified'],
          },
        },
      },
      required: ['repoName', 'featureSlug', 'updates'],
    },
  },
  {
    name: 'save_workflow_checkpoint',
    description:
      'Save a workflow checkpoint to enable resuming from this point. Useful for long workflows that may be interrupted.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: { type: 'string', description: 'Repository name' },
        featureSlug: { type: 'string', description: 'Feature slug name' },
        description: { type: 'string', description: 'Checkpoint description (e.g., "After developer batch complete")' },
      },
      required: ['repoName', 'featureSlug', 'description'],
    },
  },
  {
    name: 'list_workflow_checkpoints',
    description:
      'List all saved checkpoints for a feature. Use to resume from a specific checkpoint if workflow is interrupted.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: { type: 'string', description: 'Repository name' },
        featureSlug: { type: 'string', description: 'Feature slug name' },
      },
      required: ['repoName', 'featureSlug'],
    },
  },
  {
    name: 'restore_workflow_checkpoint',
    description:
      'Restore a feature workflow to a previously saved checkpoint. All tasks revert to their status at checkpoint time.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: { type: 'string', description: 'Repository name' },
        featureSlug: { type: 'string', description: 'Feature slug name' },
        checkpointId: { type: 'number', description: 'Checkpoint ID to restore from' },
      },
      required: ['repoName', 'featureSlug', 'checkpointId'],
    },
  },
  {
    name: 'rollback_last_decision',
    description:
      'Undo the last decision/transition on a specific task. Reverts the task to its previous status.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: { type: 'string', description: 'Repository name' },
        featureSlug: { type: 'string', description: 'Feature slug name' },
        taskId: { type: 'string', description: 'Task ID to rollback' },
      },
      required: ['repoName', 'featureSlug', 'taskId'],
    },
  },
  {
    name: 'get_task_execution_plan',
    description:
      'Analyze task dependencies and generate optimal execution plan. Detects circular dependencies, identifies parallelizable tasks, and suggests execution strategy.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: { type: 'string', description: 'Repository name' },
        featureSlug: { type: 'string', description: 'Feature slug name' },
      },
      required: ['repoName', 'featureSlug'],
    },
  },
  {
    name: 'get_workflow_metrics',
    description:
      'Get comprehensive workflow health metrics. Returns health score (0-100), rejection rates, rework cycles, and alerts for concerning patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: { type: 'string', description: 'Repository name' },
        featureSlug: { type: 'string', description: 'Feature slug name' },
      },
      required: ['repoName', 'featureSlug'],
    },
  },
  {
    name: 'validate_review_completeness',
    description:
      'Validate that all required fields are present for a stakeholder review before submission. Prevents incomplete reviews from being submitted.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: { type: 'string', description: 'Repository name' },
        featureSlug: { type: 'string', description: 'Feature slug name' },
        taskId: { type: 'string', description: 'Task ID' },
        stakeholder: {
          type: 'string',
          enum: ['productDirector', 'architect', 'uiUxExpert', 'securityOfficer'],
          description: 'Stakeholder role',
        },
      },
      required: ['repoName', 'featureSlug', 'taskId', 'stakeholder'],
    },
  },
  {
    name: 'get_similar_tasks',
    description:
      'Find similar tasks across other features. Useful for finding examples and estimating task complexity based on past work.',
    inputSchema: {
      type: 'object',
      properties: {
        repoName: { type: 'string', description: 'Repository name' },
        featureSlug: { type: 'string', description: 'Feature slug name' },
        taskId: { type: 'string', description: 'Reference task ID' },
        limit: {
          type: 'number',
          description: 'Maximum number of similar tasks to return (default: 5)',
        },
      },
      required: ['repoName', 'featureSlug', 'taskId'],
    },
  },
];

