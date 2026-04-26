\pset format unaligned
\pset tuples_only on
\pset pager off

SELECT 'users_total|' || COUNT(*) FROM "User";
SELECT 'transactions_total|' || COUNT(*) FROM "Transaction";
SELECT 'transactions_amount_total|' || COALESCE(ROUND(SUM("amount")::numeric, 2), 0)::text FROM "Transaction";
SELECT 'summaries_total|' || COUNT(*) FROM "Summary";
SELECT 'budgets_total|' || COUNT(*) FROM "Budget";
SELECT 'conversation_sessions_total|' || COUNT(*) FROM "ConversationSession";
SELECT 'custom_line_items_total|' || COUNT(*) FROM "CustomLineItem";
SELECT 'subscription_grants_total|' || COUNT(*) FROM "SubscriptionGrant";
SELECT 'subscription_payments_total|' || COUNT(*) FROM "SubscriptionPayment";

SELECT
  'transactions_per_user_signature|'
  || COALESCE(
    md5(
      string_agg(
        entry,
        '|'
        ORDER BY entry
      )
    ),
    'none'
  )
FROM (
  SELECT
    "userId" || ':' || COUNT(*)::text || ':' || COALESCE(ROUND(SUM("amount")::numeric, 2), 0)::text AS entry
  FROM "Transaction"
  GROUP BY "userId"
) per_user;
