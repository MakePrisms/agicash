#!/usr/bin/env bash

# Get the current hostname
HOSTNAME=$(hostname)

# Get the local IP address (excluding entire 127.x.x.x loopback range)
LOCAL_IP=$(ifconfig | grep "inet " | awk '{print $2}' | grep -v "^127\." | head -1)

# Check if SSL certificate already exist and cover current hostname and local IP
if [ -f "certs/localhost-cert.pem" ] && [ -f "certs/localhost-key.pem" ]; then  
  # Extract Subject Alternative Names from the certificate
  CERT_SANS=$(openssl x509 -in certs/localhost-cert.pem -text -noout 2>/dev/null | grep -A 1 "Subject Alternative Name" | tail -1 | tr ',' '\n' | sed 's/^ *//' | grep -E "(DNS:|IP Address:)" | sed 's/DNS://g' | sed 's/IP Address://g' | tr '\n' ' ')
  
  # Check if current hostname and IP are covered
  HOSTNAME_COVERED=false
  IP_COVERED=false
  
  if echo "$CERT_SANS" | grep -q "$HOSTNAME"; then
    HOSTNAME_COVERED=true
  fi
  
  if echo "$CERT_SANS" | grep -q "$LOCAL_IP"; then
    IP_COVERED=true
  fi
  
  if [ "$HOSTNAME_COVERED" = true ] && [ "$IP_COVERED" = true ]; then
    echo "✅ SSL certificate exists. It includes: localhost, 127.0.0.1, ::1, $HOSTNAME, $LOCAL_IP"
    echo "🚀 Access your app at: https://localhost:3000, https://$HOSTNAME:3000 or https://$LOCAL_IP:3000"
    echo "💡 Run 'generate-ssl-cert' to regenerate if needed"
    exit 0
  else
    echo "⚠️  SSL certificate exists but doesn't cover current environment:"
    if [ "$HOSTNAME_COVERED" = false ]; then
      echo "   ❌ Hostname '$HOSTNAME' not found in certificate"
    fi
    if [ "$IP_COVERED" = false ]; then
      echo "   ❌ IP address '$LOCAL_IP' not found in certificate"
    fi
    echo "🔄 Regenerating certificate to include current environment..."
  fi
else
  # SSL certificate don't exist, generate it
  echo "🔍 SSL certificate not found, generating it automatically..."
fi

# Check if mkcert CA is installed
if ! mkcert -CAROOT &>/dev/null; then
  echo "📋 Installing mkcert CA (you may be prompted for password)..."
  mkcert -install
fi

# Generate certificate
echo "🔧 Generating SSL certificate for: localhost, $HOSTNAME and $LOCAL_IP"

# Create certs directory if it doesn't exist
mkdir -p certs

# Generate certificate with current hostname and local IP
mkcert -key-file certs/localhost-key.pem -cert-file certs/localhost-cert.pem localhost 127.0.0.1 ::1 "$HOSTNAME" "$LOCAL_IP"

echo "✅ SSL certificate generated!"
echo "🚀 You can now access your app at: https://localhost:3000, https://$HOSTNAME:3000 or https://$LOCAL_IP:3000" 