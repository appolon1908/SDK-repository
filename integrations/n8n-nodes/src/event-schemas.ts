// Generated from canonical AsyncAPI/JSON Schema; run pnpm contracts:n8n:generate.
export const eventSchemas = {
  "codestra.social.post.status.v1": {
    "allOf": [
      {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "specversion",
          "id",
          "tenantid",
          "source",
          "type",
          "time",
          "datacontenttype",
          "data"
        ],
        "properties": {
          "specversion": {
            "const": "1.0"
          },
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "tenantid": {
            "type": "string",
            "format": "uuid"
          },
          "source": {
            "type": "string",
            "format": "uri-reference"
          },
          "type": {
            "type": "string"
          },
          "subject": {
            "type": "string"
          },
          "time": {
            "type": "string",
            "format": "date-time"
          },
          "datacontenttype": {
            "const": "application/json"
          },
          "dataschema": {
            "type": "string",
            "format": "uri"
          },
          "data": {}
        }
      },
      {
        "type": "object",
        "properties": {
          "type": {
            "const": "codestra.social.post.status.v1"
          },
          "data": {
            "title": "Social post status event data",
            "type": "object",
            "additionalProperties": false,
            "required": [
              "postId",
              "tenantId",
              "status",
              "deliveries",
              "occurredAt"
            ],
            "properties": {
              "postId": {
                "type": "string",
                "format": "uuid"
              },
              "tenantId": {
                "type": "string",
                "format": "uuid"
              },
              "previousStatus": {
                "type": "string",
                "enum": [
                  "accepted",
                  "scheduled",
                  "publishing",
                  "published",
                  "partially_published",
                  "failed",
                  "cancelled"
                ]
              },
              "status": {
                "type": "string",
                "enum": [
                  "accepted",
                  "scheduled",
                  "publishing",
                  "published",
                  "partially_published",
                  "failed",
                  "cancelled"
                ]
              },
              "deliveries": {
                "type": "array",
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "required": [
                    "channel",
                    "status"
                  ],
                  "properties": {
                    "channel": {
                      "type": "string"
                    },
                    "status": {
                      "type": "string",
                      "enum": [
                        "accepted",
                        "scheduled",
                        "publishing",
                        "published",
                        "partially_published",
                        "failed",
                        "cancelled"
                      ]
                    },
                    "externalId": {
                      "type": "string"
                    },
                    "failureCode": {
                      "type": "string"
                    },
                    "failureMessage": {
                      "type": "string"
                    }
                  }
                }
              },
              "occurredAt": {
                "type": "string",
                "format": "date-time"
              }
            }
          }
        }
      }
    ]
  },
  "codestra.webhook.delivery.status.v1": {
    "allOf": [
      {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "specversion",
          "id",
          "tenantid",
          "source",
          "type",
          "time",
          "datacontenttype",
          "data"
        ],
        "properties": {
          "specversion": {
            "const": "1.0"
          },
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "tenantid": {
            "type": "string",
            "format": "uuid"
          },
          "source": {
            "type": "string",
            "format": "uri-reference"
          },
          "type": {
            "type": "string"
          },
          "subject": {
            "type": "string"
          },
          "time": {
            "type": "string",
            "format": "date-time"
          },
          "datacontenttype": {
            "const": "application/json"
          },
          "dataschema": {
            "type": "string",
            "format": "uri"
          },
          "data": {}
        }
      },
      {
        "type": "object",
        "properties": {
          "type": {
            "const": "codestra.webhook.delivery.status.v1"
          },
          "data": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "deliveryId",
              "endpointId",
              "status",
              "occurredAt"
            ],
            "properties": {
              "deliveryId": {
                "type": "string",
                "format": "uuid"
              },
              "endpointId": {
                "type": "string",
                "format": "uuid"
              },
              "status": {
                "type": "string",
                "enum": [
                  "queued",
                  "attempting",
                  "delivered",
                  "failed",
                  "dead_lettered"
                ]
              },
              "attempt": {
                "type": "integer",
                "minimum": 0
              },
              "occurredAt": {
                "type": "string",
                "format": "date-time"
              }
            }
          }
        }
      }
    ]
  }
} as const;
