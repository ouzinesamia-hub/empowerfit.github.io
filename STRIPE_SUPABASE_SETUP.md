# Connexion Stripe → Supabase pour EMPOWERFIT

Cette intégration transforme les paiements Stripe en abonnements ou crédits utilisables dans la page de réservation.

## Sécurité

- Ne jamais placer `STRIPE_SECRET_KEY` ou `STRIPE_WEBHOOK_SECRET` dans un fichier GitHub.
- Ne jamais transmettre ces secrets dans une conversation.
- Les enregistrer uniquement dans **Supabase → Edge Functions → Secrets**.

## 1. Installer la base de données

Dans **Supabase → SQL Editor**, exécuter le fichier :

`supabase/migrations/202608250001_stripe_entitlements.sql`

Cette migration :

- associe les huit liens Stripe à leurs offres ;
- crée les droits d’accès et les crédits ;
- crédite 10 séances pour la carte 10 cours, valables 90 jours ;
- limite START TEN et BALANCE à 2 cours par semaine ;
- limite SERENITY à 1 cours par semaine ;
- considère INFINITY comme illimité ;
- exige un paiement ou un crédit avant toute réservation ;
- rend automatiquement le crédit lorsqu’une réservation payée avec un crédit est annulée.

## 2. Déployer la fonction

Déployer `supabase/functions/stripe-webhook/index.ts` en tant qu’Edge Function nommée :

`stripe-webhook`

La fonction doit être publique (`verify_jwt = false`) car l’authenticité est contrôlée par la signature Stripe.

URL attendue pour ce projet :

`https://fkyieurufkxdvzovcqzj.supabase.co/functions/v1/stripe-webhook`

## 3. Enregistrer les secrets

Dans **Supabase → Edge Functions → Secrets**, ajouter :

- `STRIPE_SECRET_KEY` : clé Stripe secrète du mode utilisé ;
- `STRIPE_WEBHOOK_SECRET` : secret de signature fourni après la création du webhook Stripe.

## 4. Créer le webhook Stripe

Dans **Stripe → Développeurs → Webhooks**, ajouter l’URL de la fonction et sélectionner :

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Copier le secret de signature `whsec_…` directement dans le secret Supabase `STRIPE_WEBHOOK_SECRET`.

## 5. Tester avant publication

1. Utiliser le mode test Stripe et des liens de test équivalents.
2. Réaliser un achat de chaque type.
3. Vérifier la création d’une ligne dans `customer_entitlements`.
4. Réserver avec exactement la même adresse e-mail que celle utilisée dans Stripe.
5. Vérifier le débit puis la restitution d’un crédit après annulation.
6. Ne passer en production qu’après ces contrôles.

## Point START TEN

Le webhook programme l’arrêt de l’abonnement au 1er juillet suivant. Le lien Stripe doit commencer la facturation au bon moment afin que les prélèvements correspondent bien à septembre–juin.

