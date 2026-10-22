/**
 * Attribute keys. OTel semantic-convention names where one exists, `mcpy.*`
 * otherwise. Dashboards and sinks depend on these: change with care.
 */
export const Attr = {
  // OTel semantic conventions
  ServiceName: "service.name",
  ServiceVersion: "service.version",
  ClientName: "client.name",
  HttpMethod: "http.request.method",
  HttpStatus: "http.response.status_code",
  HttpResendCount: "http.request.resend_count",
  HttpRoute: "http.route",
  ServerAddress: "server.address",
  UrlPath: "url.path",
  ErrorType: "error.type",

  // mcpy
  RequestId: "mcpy.request.id",
  CfRay: "mcpy.cf_ray",
  Operation: "mcpy.operation",
  Provider: "mcpy.provider",
  Outcome: "mcpy.outcome",
  Reason: "mcpy.reason",
  Cache: "mcpy.cache",
  CostUsd: "mcpy.cost.usd",
  ContentChars: "mcpy.content.chars",
  OutputChars: "mcpy.output.chars",
  Attempts: "mcpy.attempts",
  TargetHost: "mcpy.target.host",
  TargetStatus: "mcpy.target.status",
  UserAgentProfile: "mcpy.user_agent.profile",
  Transport: "mcpy.transport",
} as const;

export type AttrKey = (typeof Attr)[keyof typeof Attr];
