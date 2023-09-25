#!/bin/sh

# Use envsubst to replace the placeholders in config.template.js with real environment variables, generating config.js.
envsubst < ./config.template.js > ./public/config.js

# Now, run the provided CMD command (in our case, "start" which translates to "yarn next start")
exec yarn next start
