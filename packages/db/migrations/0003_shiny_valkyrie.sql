CREATE TYPE "public"."activity_outcome" AS ENUM('ok', 'denied', 'invalid', 'rate_limited', 'error');--> statement-breakpoint
CREATE TABLE "agent_activity" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"required_scope" text,
	"outcome" "activity_outcome" NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"changed_fields" text[],
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	"client_name" text NOT NULL,
	"grant_id" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "agent_connections_grant_id_unique" UNIQUE("grant_id")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"connection_id" uuid NOT NULL,
	"key" text NOT NULL,
	"tool" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_connection_id_key_pk" PRIMARY KEY("connection_id","key")
);
--> statement-breakpoint
CREATE TABLE "oauth_records" (
	"model" text NOT NULL,
	"id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"grant_id" text,
	"uid" text,
	"user_code" text,
	"expires_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_records_model_id_pk" PRIMARY KEY("model","id")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_activity" ADD CONSTRAINT "agent_activity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_activity" ADD CONSTRAINT "agent_activity_connection_id_agent_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."agent_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_connections" ADD CONSTRAINT "agent_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_connection_id_agent_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."agent_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_activity_user_idx" ON "agent_activity" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_activity_connection_idx" ON "agent_activity" USING btree ("connection_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_connections_user_idx" ON "agent_connections" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "oauth_records_grant_idx" ON "oauth_records" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "oauth_records_uid_idx" ON "oauth_records" USING btree ("uid");--> statement-breakpoint
CREATE INDEX "oauth_records_expires_idx" ON "oauth_records" USING btree ("expires_at");