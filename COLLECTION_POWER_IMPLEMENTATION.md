# Collection POWER — architecture de vente (brouillon, non déployé)

## Objet
Vendre les 3 ebooks PDF EMPOWERFIT (Power Yoga / Power Pilates / Power Fit) à 17 € TTC affichés chacun, ou le pack complet à 39 € TTC, depuis le site officiel. Ce document décrit le parcours proposé ; aucun paiement, envoi ou déploiement n'est activé par cette branche.

## Hébergement
- GitHub conserve les **sources** et sert à relire les modifications dans une pull request.
- Le site commercial final doit être servi par l'hébergement existant **o2switch**, une fois les outils de livraison opérationnels.
- Ne pas utiliser GitHub Pages comme plate-forme principale de commerce électronique : ses conditions d'usage limitent cet usage.

## Parcours choisi
1. L'acheteuse ouvre `collection-power.html` depuis le site EMPOWERFIT.
2. Quatre boutons distincts ouvriront quatre liens Stripe Checkout/Payment Links **une fois créés et vérifiés**.
3. Stripe collecte le paiement et l'e-mail de l'acheteuse.
4. **Nouveau** webhook Stripe dédié aux ebooks (Supabase Edge Function, séparée de `stripe-webhook` des abonnements) vérifie la signature Stripe et le statut payé.
5. Le webhook enregistre une commande ebook idempotente dans une nouvelle table dédiée (`ebook_orders`) sans créer de droits de réservation.
6. Un service d'envoi e-mail vérifié envoie un lien signé à durée limitée vers le ou les PDF.
7. Une page de confirmation dédiée explique de vérifier sa boîte e-mail, sans considérer l'affichage de la page comme une preuve de paiement.

## Stockage des PDF
- Bucket Supabase Storage **privé** pour les fichiers de la collection.
- Pas de PDF payant dans le dépôt GitHub, le dossier public du site ou les assets o2switch accessibles sans contrôle.
- Liens d'accès signés, durée limitée ; l'envoi peut être réessayé en cas de panne sans double prélèvement.

## Sécurité et robustesse
- Clés Stripe et Supabase uniquement dans les secrets serveur, jamais dans HTML/JavaScript public.
- Webhook Stripe : utiliser le corps brut de la requête, valider la signature officielle, ne traiter que les événements de paiement réellement réussis.
- Une commande par session Stripe, événement/notification idempotent, journal d'envoi (succès/échec), possibilité de renvoi manuel.
- RLS activée et aucun accès de lecture public aux commandes, e-mails ou documents privés.
- Le webhook existant des réservations, les abonnements, les bilans, la page `paiement-confirme.html` et les URLs de FITÉRUS ne doivent pas être modifiés.

## Suivi
- Stripe reste la source comptable des encaissements, remboursements, frais et paiements.
- Supabase sert au suivi opérationnel : commande, produit, montant, date, e-mail, état de livraison, source d'acquisition facultative.
- Supabase n'est pas indispensable pour **voir les ventes** ; il devient utile pour automatiser et tracer la livraison numérique.

## À vérifier avant publication
- Domaine et route commerciale sur o2switch, avec tests sur téléphone.
- Quatre produits/Payment Links dans **le bon compte Stripe**, bons tarifs/devise, TVA et règles fiscales approuvées.
- Identifiants des offres reliés au webhook sans ambiguïté.
- Service e-mail configuré, domaine expéditeur vérifié, e-mails délivrables.
- Consentement et information sur l'exécution immédiate d'un contenu numérique et la rétractation, CGV, mentions légales, confidentialité (à valider juridiquement).
- Achat de test de chacun des quatre produits, réception du bon lien, accès au bon PDF, aucune double livraison ou commande.
- Déployer sur o2switch **uniquement après validation**.

## État vérifié le 22 novembre 2026
- Page commerciale maquette créée sur une branche GitHub de préparation.
- Boutons de paiement volontairement désactivés.
- **Migration SQL exécutée dans le projet Supabase `empowerfit-reservations`** : les tables `public.ebook_orders` et `public.ebook_webhook_events` existent, RLS activée, accès publics révoqués.
- **Bucket privé `ebooks-empowerfit` créé**, avec `public = false` et PDF uniquement. Les fichiers ne sont PAS encore téléchargés dans le bucket.
- Le fichier `supabase/migrations/202611210001_ebook_orders.sql` est la version contrôlée de la structure déjà appliquée ; attention aux outils de migrations avant `db push`.
- Le code `ebook-stripe-webhook` est en brouillon GitHub, **non déployé**.
- Aucun nouveau produit, lien Stripe ni e-mail acheteur n'est actif.

## Fichiers à déposer manuellement dans `ebooks-empowerfit`
Conserver **exactement** ces noms à la racine :
- `power-yoga-femme-forte.pdf` (36 pages)
- `power-pilates-femme-solide.pdf` (36 pages)
- `power-fit-femme-puissante.pdf` (36 pages)

Ils sont regroupés dans l'archive `EMPOWERFIT_LIVRAISON_PRIVEE_3_PDF.zip` livrée dans la conversation, mais cette archive ne doit pas être publiée sur le site.

## Pour éviter une mise en vente prématurée
Ne pas fusionner cette PR ni activer les boutons d'achat tant que : (1) les trois PDF ne sont pas dans le bucket, (2) les produits et prix Stripe ne sont pas correctement définis, (3) le service e-mail n'est pas configuré et testé, (4) le traitement de la TVA et les CGV ne sont pas validés.


## Lancement accéléré : téléchargement immédiat, sans attendre Resend
- `ebook-merci.html` est une page de retour Stripe créée sur la branche de préparation, **non publiée**.
- `supabase/functions/ebook-access/index.ts` est une Edge Function créée sur la branche, **non déployée**.
- À la confirmation Stripe, rediriger vers `https://www.empowerfit-studio.fr/ebook-merci.html?session_id={CHECKOUT_SESSION_ID}` (après confirmation que cette route est accessible).
- La page retire immédiatement la référence de paiement de la barre d'adresse ; la fonction vérifie le paiement auprès de Stripe, un identifiant de prix autorisé et la correspondance du montant.
- La fonction délivre les liens privés signés vers les PDF et inscrit la commande dans `ebook_orders`.
- À configurer côté secrets Supabase : `EBOOK_PRICE_YOGA`, `EBOOK_PRICE_PILATES`, `EBOOK_PRICE_FIT`, `EBOOK_PRICE_PACK`. Les autres secrets serveur sont recherchés parmi ceux du webhook existant.
- Les e-mails Resend restent un deuxième mécanisme de livraison à mettre en place après validation du domaine. **Ce parcours sans e-mail exige d'avertir les clientes de sauvegarder immédiatement les PDF** ; pour la production, prévoir récupération de commande/réémission en cas de perte du lien.
- **Tester intégralement en mode test ou sur environnement sécurisé, puis production contrôlée, avant toute vente**.

## Identifiants Stripe créés (production, inactifs) — 22 novembre 2026
Les quatre produits et prix Stripe suivants sont créés en **mode live mais inactifs** ; aucun lien de paiement n'a été ouvert. Le `tax_code` `txcd_10302000` est une catégorie candidate « livre numérique téléchargé » **à valider fiscalement** avant activation ; les prix sont TTC (`tax_behavior=inclusive`).

| Code | Produit Stripe | Tarif Stripe | Montant |
|---|---|---|---|
| yoga | `prod_VfyJGSPodgtICq` | `price_1UecNGAgR1CLpeJl0A8YSRaR` | 17 € |
| pilates | `prod_VfyJdYIvaVtkiQ` | `price_1UecNIAgR1CLpeJlEE7XV43q` | 17 € |
| fit | `prod_VfyJ4CwSeicACl` | `price_1UecNKAgR1CLpeJlm4mDU3HO` | 17 € |
| pack | `prod_VfyJjzh6sMG2u5` | `price_1UecNMAgR1CLpeJlviBqMmEa` | 39 € |

Variables secrètes de la fonction `ebook-access` à configurer côté Supabase (identifiants de prix publics, aucun secret Stripe à partager dans le code) :
- `EBOOK_PRICE_YOGA=price_1UecNGAgR1CLpeJl0A8YSRaR`
- `EBOOK_PRICE_PILATES=price_1UecNIAgR1CLpeJlEE7XV43q`
- `EBOOK_PRICE_FIT=price_1UecNKAgR1CLpeJlm4mDU3HO`
- `EBOOK_PRICE_PACK=price_1UecNMAgR1CLpeJlviBqMmEa`

Avant publication : confirmer le régime TVA applicable à ces ouvrages et si Stripe Tax doit être activé ; vérifier les tests de paiement, la bonne URL de retour et la récupération après achat.

## Variante urgente : paiement Stripe accessible sans o2switch (22 novembre 2026)
- `ebook-receipt` a été déployée sur Supabase pour servir la page de récupération sans attendre la remise en ligne du domaine commercial.
- URL publique de retour **sans information personnelle** :
  `https://fkyieurufkxdvzovcqzj.supabase.co/functions/v1/ebook-receipt`.
- La redirection de Stripe devra être :
  `https://fkyieurufkxdvzovcqzj.supabase.co/functions/v1/ebook-receipt?session_id={CHECKOUT_SESSION_ID}`
  après validation des tests et de l'option de redirection Stripe.
- `ebook-access` est déployée version 6, avec l'origine Supabase de la page de retour autorisée. Cette fonction vérifie le paiement via Stripe avant de renvoyer des liens privés temporaires.
- `ebook-checkout` est déployée, **fermée par défaut** (variable `EBOOK_SALES_OPEN` absente = false).
- Les 4 produits Stripe et les prix ont été créés en production mais laissés **inactifs** ; aucun lien de paiement client n'a été créé.
- Les 4 variables `EBOOK_PRICE_*` sont indiquées par l'utilisatrice comme enregistrées côté Supabase ; leurs valeurs effectives ne sont pas lisibles par le connecteur actuel et leur fonctionnement doit être testé.
- Avant vente publique, s'assurer de la qualification fiscale, des conditions de vente et de la possibilité de récupérer les livres si la page est quittée avant le téléchargement (envoi e-mail ou canal de support fiable).
- La page Google/GitHub du site n'a pas été modifiée ; les achats pourront transiter directement via des Payment Links Stripe distribués sur Instagram.
