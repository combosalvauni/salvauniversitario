#!/bin/bash
echo >> /var/www/concursaflix/.env
echo '# Meta Conversions API (server-side pixel)' >> /var/www/concursaflix/.env
echo 'META_PIXEL_ID=1665717361520339' >> /var/www/concursaflix/.env
echo 'META_CAPI_ACCESS_TOKEN=EAANGhVUwtsoBRGeinsgN5X8JA3bppVBpuzS17JzeEcMDdRfv3P4bCPOdlZCqYZB4GutFcwOwHTMnNGP8VQaWAtghZCFiBB9yFHZARSK8k1wKFMG2Ipdv92FcAcSK4j17ouSnmCc4u56KnwgHJ6iO0uqGS7fc958nH2J6u2Ble3z9mwnfujZBBu3kOoEGAGgZDZD' >> /var/www/concursaflix/.env
grep -n META /var/www/concursaflix/.env
