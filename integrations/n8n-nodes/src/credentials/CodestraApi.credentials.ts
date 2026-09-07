import type { IAuthenticateGeneric, ICredentialType, INodeProperties } from "n8n-workflow";

export class CodestraApi implements ICredentialType {
  name = "codestraApi";
  displayName = "Codestra API";
  documentationUrl = "https://github.com/appolon1908-hue/SDK-repository";

  properties: INodeProperties[] = [
    {
      displayName: "Base URL",
      name: "baseUrl",
      type: "string",
      default: "https://api.codestra.co",
      required: true,
    },
    {
      displayName: "Tenant ID",
      name: "tenantId",
      type: "string",
      default: "",
      required: true,
    },
    {
      displayName: "Service Access Token",
      name: "accessToken",
      type: "string",
      typeOptions: { password: true },
      default: "",
      required: true,
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: "generic",
    properties: {
      headers: {
        Authorization: "=Bearer {{$credentials.accessToken}}",
        "X-Codestra-Tenant-Id": "={{$credentials.tenantId}}",
      },
    },
  };
}
