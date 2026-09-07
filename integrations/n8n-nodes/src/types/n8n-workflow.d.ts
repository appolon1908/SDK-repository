declare module "n8n-workflow" {
  export type IDataObject = Record<string, unknown>;
  export type INodeProperties = Record<string, unknown>;
  export type ICredentialDataDecryptedObject = Record<string, unknown>;

  export interface IAuthenticateGeneric {
    type: "generic";
    properties: Record<string, unknown>;
  }

  export interface ICredentialType {
    name: string;
    displayName: string;
    documentationUrl?: string;
    properties: INodeProperties[];
    authenticate?: IAuthenticateGeneric;
  }

  export interface INodeExecutionData {
    json: IDataObject;
    pairedItem?: { item: number };
  }

  export interface IRequestOptions {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: unknown;
    json?: boolean;
    timeout?: number;
    returnFullResponse?: boolean;
  }

  export interface IExecuteFunctions {
    getInputData(): INodeExecutionData[];
    getNodeParameter(name: string, itemIndex: number, fallback?: unknown): unknown;
    getCredentials(name: string): Promise<ICredentialDataDecryptedObject>;
    helpers: {
      httpRequestWithAuthentication(
        this: IExecuteFunctions,
        credentialType: string,
        options: IRequestOptions,
      ): Promise<unknown>;
    };
  }

  export interface IWebhookFunctions {
    getRequestObject(): { rawBody?: Uint8Array; rawHeaders?: string[]; readRawBody?: () => Promise<void> };
    getResponseObject(): { status(code: number): { json(body: unknown): unknown } };
    getCredentials(name: string): Promise<ICredentialDataDecryptedObject>;
    getHeaderData(): Record<string, string | string[] | undefined>;
    getBodyData(): IDataObject;
    helpers: {
      returnJsonArray(items: IDataObject[]): INodeExecutionData[];
    };
  }

  export interface IWebhookResponseData {
    noWebhookResponse?: boolean;
    webhookResponse?: { status: number; body?: unknown };
    workflowData?: INodeExecutionData[][];
  }

  export interface INodeTypeDescription extends Record<string, unknown> {
    displayName: string;
    name: string;
    group: string[];
    version: number;
    description: string;
    defaults: { name: string };
    inputs: string[];
    outputs: string[];
    properties: INodeProperties[];
  }

  export interface INodeType {
    description: INodeTypeDescription;
    execute?(this: IExecuteFunctions): Promise<INodeExecutionData[][]>;
    webhook?(this: IWebhookFunctions): Promise<IWebhookResponseData>;
  }
}
