export const JSON_SCHEMAS = {
  summary: {
    type: 'json_schema' as const,
    json_schema: {
      name: 'SummaryJSON',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          opinions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                supporters: { type: 'array', items: { type: 'string' } },
                quotes: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      author: { type: 'string' },
                      postNumber: { type: 'integer' },
                      text: { type: 'string' },
                    },
                    required: ['author', 'postNumber', 'text'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['title', 'description', 'supporters', 'quotes'],
              additionalProperties: false,
            },
          },
          conclusion: { type: 'string' },
        },
        required: ['summary', 'opinions', 'conclusion'],
        additionalProperties: false,
      },
    },
  },
  knowledge: {
    type: 'json_schema' as const,
    json_schema: {
      name: 'KnowledgeArray',
      strict: true,
      schema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            content: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            category: { type: 'string' },
            source: {
              type: 'object',
              properties: {
                author: { type: 'string' },
                postNumber: { type: 'integer' },
              },
              required: ['author', 'postNumber'],
              additionalProperties: false,
            },
          },
          required: ['title', 'content', 'tags', 'category', 'source'],
          additionalProperties: false,
        },
      },
    },
  },
  analysis: {
    type: 'json_schema' as const,
    json_schema: {
      name: 'ThreadAnalysisJSON',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          overview: {
            type: 'object',
            properties: {
              heat: { type: 'string', enum: ['hot', 'normal', 'low'] },
              coreConflict: { type: 'string' },
              keyFacts: { type: 'array', items: { type: 'string' } },
              misconception: { type: 'string' },
            },
            required: ['heat', 'coreConflict', 'keyFacts', 'misconception'],
            additionalProperties: false,
          },
          userProfiles: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string' },
                description: { type: 'string' },
                note: { type: 'string' },
                quote: { type: 'string' },
              },
              required: ['role', 'description', 'note', 'quote'],
              additionalProperties: false,
            },
          },
          debateStreams: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                heat: { type: 'string', enum: ['high', 'medium', 'low'] },
                description: { type: 'string' },
              },
              required: ['title', 'heat', 'description'],
              additionalProperties: false,
            },
          },
          combats: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                sideA: { type: 'string' },
                sideB: { type: 'string' },
                note: { type: 'string' },
              },
              required: ['title', 'sideA', 'sideB', 'note'],
              additionalProperties: false,
            },
          },
          timeline: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                pageRange: { type: 'string' },
                events: { type: 'array', items: { type: 'string' } },
              },
              required: ['name', 'pageRange', 'events'],
              additionalProperties: false,
            },
          },
          notableComments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['defining', 'insightful', 'meme'] },
                author: { type: 'string' },
                text: { type: 'string' },
              },
              required: ['type', 'author', 'text'],
              additionalProperties: false,
            },
          },
          conclusion: {
            type: 'object',
            properties: {
              breakdown: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string' },
                    percent: { type: 'integer' },
                  },
                  required: ['label', 'percent'],
                  additionalProperties: false,
                },
              },
              insightPolicy: { type: 'string' },
              insightPublic: { type: 'string' },
              finalNote: { type: 'string' },
            },
            required: ['breakdown', 'insightPolicy', 'insightPublic', 'finalNote'],
            additionalProperties: false,
          },
          wuxia: { type: 'string' },
        },
        required: ['overview', 'userProfiles', 'debateStreams', 'combats', 'timeline', 'notableComments', 'conclusion', 'wuxia'],
        additionalProperties: false,
      },
    },
  },
} as const;

export type SchemaName = keyof typeof JSON_SCHEMAS;
