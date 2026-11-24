CREATE TABLE "income_actuals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"month" text NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"connection_id" uuid,
	"data" text NOT NULL,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "income_actuals" ADD CONSTRAINT "income_actuals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "income_actuals_user_idx" ON "income_actuals" USING btree ("user_id","month");