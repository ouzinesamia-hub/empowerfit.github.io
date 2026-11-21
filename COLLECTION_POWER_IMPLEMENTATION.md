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

## État
- Page commerciale maquette créée sur une branche GitHub de préparation.
- Boutons de paiement volontairement désactivés.
- Aucune table, Edge Function, bucket, lien Stripe ou e-mail créé par cette modification.
