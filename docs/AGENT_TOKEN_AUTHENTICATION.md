# Agent Token Authentication System

This document describes the decentralized token-based authentication system that allows AI agents to post tweets on behalf of users without requiring passwords.

## Overview

The Agent Token system uses **Ed25519 digital signatures** to authenticate AI agent requests. Users generate a cryptographic keypair, store the public key on the server, and provide the private key (wrapped in a token) to AI agents. The agent signs requests with the private key, and the server verifies signatures using the stored public key.

### Key Benefits

- **No password sharing**: AI agents never see the user's password
- **Decentralized**: No central token server; verification uses user's stored public key
- **Revocable**: User regenerates keypair to instantly revoke all agent access
- **Auditable**: Server logs which requests were made via agent auth
- **Replay-protected**: Timestamps prevent request replay attacks

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           USER SETUP (One-Time)                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────┐    ┌─────────────────┐    ┌─────────────────────────┐ │
│  │   iOS App    │───▶│  Generate       │───▶│  Save publicKey to      │ │
│  │   Settings   │    │  Ed25519 Keypair│    │  Server (user profile)  │ │
│  └──────────────┘    └─────────────────┘    └─────────────────────────┘ │
│                              │                                           │
│                              ▼                                           │
│                      ┌─────────────────┐                                 │
│                      │  Export Token   │                                 │
│                      │  (contains      │                                 │
│                      │  privateKey)    │                                 │
│                      └────────┬────────┘                                 │
│                               │                                          │
│                               ▼                                          │
│                      ┌─────────────────┐                                 │
│                      │  User copies    │                                 │
│                      │  token to       │                                 │
│                      │  AI Agent       │                                 │
│                      └─────────────────┘                                 │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                       AI AGENT POSTING FLOW                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────┐    ┌─────────────────┐    ┌─────────────────────────┐ │
│  │  AI Agent    │───▶│  Decode Token   │───▶│  Sign Request Data      │ │
│  │  has Token   │    │  get privateKey │    │  with privateKey        │ │
│  └──────────────┘    └─────────────────┘    └───────────┬─────────────┘ │
│                                                         │                │
│                                                         ▼                │
│                                             ┌─────────────────────────┐  │
│                                             │  Send Request with      │  │
│                                             │  agentAuth: {           │  │
│                                             │    mimeiId,             │  │
│                                             │    timestamp,           │  │
│                                             │    signature            │  │
│                                             │  }                      │  │
│                                             └───────────┬─────────────┘  │
│                                                         │                │
│                                                         ▼                │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                         SERVER                                    │   │
│  │  1. Check timestamp freshness (< 5 minutes)                      │   │
│  │  2. Fetch user's agentPublicKey from profile                     │   │
│  │  3. Reconstruct signed data                                      │   │
│  │  4. Verify Ed25519 signature                                     │   │
│  │  5. If valid: create tweet as user                               │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Token Format

The agent token is a Base64-encoded JSON object:

```json
{
  "version": 1,
  "mimeiId": "abc123...",           // User's Mimei ID (27 characters)
  "privateKey": "base64...",        // Ed25519 private key (32 bytes, Base64)
  "publicKey": "base64...",         // Ed25519 public key (32 bytes, Base64)
  "createdAt": 1708444800000,       // Unix timestamp (milliseconds)
  "scope": ["post", "comment"]      // Allowed actions
}
```

**Example encoded token:**
```
eyJ2ZXJzaW9uIjoxLCJtaW1laUlkIjoiYWJjMTIzLi4uIiwicHJpdmF0ZUtleSI6ImJhc2U2NC4uLiIsInB1YmxpY0tleSI6ImJhc2U2NC4uLiIsImNyZWF0ZWRBdCI6MTcwODQ0NDgwMDAwMCwic2NvcGUiOlsicG9zdCIsImNvbW1lbnQiXX0=
```

## Request Signing

When an AI agent makes a request, it must:

1. **Prepare the data to sign** (sorted keys for consistency):
```json
{
  "authorId": "user123...",
  "content": "Hello world!",
  "mimeiId": "user123...",
  "timestamp": 1708444800000
}
```

2. **Serialize to JSON** (with sorted keys):
```javascript
const message = JSON.stringify(sortedData)
```

3. **Sign with Ed25519**:
```javascript
const signature = ed25519.sign(message, privateKey)
```

4. **Include agentAuth in request**:
```json
{
  "aid": "app-id",
  "ver": "last",
  "tweet": { "authorId": "...", "content": "..." },
  "agentAuth": {
    "mimeiId": "user123...",
    "timestamp": 1708444800000,
    "signature": "base64-signature..."
  }
}
```

## Server Verification

The server performs these checks (in `add_tweet.js`):

1. **Timestamp check**: Request must be within 5 minutes of server time
2. **Public key lookup**: Fetch `agentPublicKey` from user's profile
3. **Data reconstruction**: Rebuild the exact data that was signed
4. **Signature verification**: Use Ed25519 to verify signature matches
5. **Identity check**: Ensure `agentAuth.mimeiId` matches `tweet.authorId`

## Implementation Files

### iOS App

| File | Purpose |
|------|---------|
| `Sources/Core/AgentTokenManager.swift` | Token generation, Keychain storage, signing utilities |
| `Sources/DataModels/User.swift` | Added `agentPublicKey` field |
| `Sources/Core/HproseInstance.swift` | Added `generateAgentToken()` and `updateAgentPublicKey()` |
| `Sources/Screens/Settings.swift` | UI for generating and copying tokens |

### Server (JavaScript/Leither)

| File | Purpose |
|------|---------|
| `add_tweet.js` | Modified to accept `agentAuth` parameter (verification inline) |
| `set_author_core_data.js` | Modified to handle `agentPublicKey` updates |
| `verify_agent_token.js` | Reusable verification function (call via `lapi.RunMApp`) |

**Note:** In Leither, each `.js` file is a standalone serverless function. Call other functions using:
```javascript
const result = lapi.RunMApp("verify_agent_token", {
    aid: APP_ID,           // mandatory
    ver: "last",           // mandatory
    agentAuth: { mimeiId, timestamp, signature },
    requestData: { authorId, content }
}, [])
```

## Android Implementation Guide

To implement the same system in Android:

### 1. Add Dependencies

```gradle
// build.gradle
dependencies {
    implementation 'org.bouncycastle:bcprov-jdk15on:1.70'
    // Or use Android's built-in Conscrypt for Ed25519
}
```

### 2. Create AgentToken Data Class

```kotlin
// AgentToken.kt
import android.util.Base64
import org.json.JSONObject
import org.json.JSONArray

data class AgentToken(
    val version: Int,
    val mimeiId: String,
    val privateKey: String,  // Base64
    val publicKey: String,   // Base64
    val createdAt: Long,
    val scope: List<String>
) {
    fun export(): String {
        val json = JSONObject().apply {
            put("version", version)
            put("mimeiId", mimeiId)
            put("privateKey", privateKey)
            put("publicKey", publicKey)
            put("createdAt", createdAt)
            put("scope", JSONArray(scope))
        }
        return Base64.encodeToString(
            json.toString().toByteArray(Charsets.UTF_8),
            Base64.NO_WRAP
        )
    }
    
    companion object {
        fun from(tokenString: String): AgentToken? {
            return try {
                val jsonString = String(
                    Base64.decode(tokenString, Base64.NO_WRAP),
                    Charsets.UTF_8
                )
                val json = JSONObject(jsonString)
                val scopeArray = json.getJSONArray("scope")
                val scope = (0 until scopeArray.length()).map { scopeArray.getString(it) }
                
                AgentToken(
                    version = json.getInt("version"),
                    mimeiId = json.getString("mimeiId"),
                    privateKey = json.getString("privateKey"),
                    publicKey = json.getString("publicKey"),
                    createdAt = json.getLong("createdAt"),
                    scope = scope
                )
            } catch (e: Exception) {
                null
            }
        }
    }
}
```

### 3. Create AgentTokenManager

```kotlin
// AgentTokenManager.kt
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.*
import java.security.spec.ECGenParameterSpec

class AgentTokenManager(private val context: Context) {
    
    private val prefs = context.getSharedPreferences("agent_token", Context.MODE_PRIVATE)
    
    /**
     * Generate new Ed25519 keypair
     */
    fun generateKeyPair(): KeyPair {
        val keyPairGenerator = KeyPairGenerator.getInstance("Ed25519")
        return keyPairGenerator.generateKeyPair()
    }
    
    /**
     * Generate complete agent token for user
     */
    fun generateToken(mimeiId: String, scope: List<String> = listOf("post", "comment")): AgentToken {
        val keyPair = generateKeyPair()
        
        val privateKeyBase64 = Base64.encodeToString(
            keyPair.private.encoded.takeLast(32).toByteArray(),
            Base64.NO_WRAP
        )
        val publicKeyBase64 = Base64.encodeToString(
            keyPair.public.encoded.takeLast(32).toByteArray(),
            Base64.NO_WRAP
        )
        
        return AgentToken(
            version = 1,
            mimeiId = mimeiId,
            privateKey = privateKeyBase64,
            publicKey = publicKeyBase64,
            createdAt = System.currentTimeMillis(),
            scope = scope
        )
    }
    
    /**
     * Save private key securely
     */
    fun savePrivateKey(mimeiId: String, privateKeyBase64: String) {
        // Use Android Keystore or EncryptedSharedPreferences for production
        prefs.edit().putString("private_key_$mimeiId", privateKeyBase64).apply()
    }
    
    /**
     * Load private key
     */
    fun loadPrivateKey(mimeiId: String): String? {
        return prefs.getString("private_key_$mimeiId", null)
    }
    
    /**
     * Delete private key (revoke)
     */
    fun deletePrivateKey(mimeiId: String) {
        prefs.edit().remove("private_key_$mimeiId").apply()
    }
    
    /**
     * Check if user has existing token
     */
    fun hasExistingToken(mimeiId: String): Boolean {
        return loadPrivateKey(mimeiId) != null
    }
    
    companion object {
        /**
         * Sign request data with token
         */
        fun signRequest(data: Map<String, Any>, token: AgentToken): AgentAuth? {
            return try {
                val timestamp = System.currentTimeMillis()
                
                val signableData = data.toMutableMap().apply {
                    put("mimeiId", token.mimeiId)
                    put("timestamp", timestamp)
                }
                
                // Sort keys and serialize
                val sortedJson = JSONObject()
                signableData.keys.sorted().forEach { key ->
                    sortedJson.put(key, signableData[key])
                }
                val message = sortedJson.toString()
                
                // Sign with Ed25519
                val privateKeyBytes = Base64.decode(token.privateKey, Base64.NO_WRAP)
                val signature = signEd25519(message.toByteArray(Charsets.UTF_8), privateKeyBytes)
                
                AgentAuth(
                    mimeiId = token.mimeiId,
                    timestamp = timestamp,
                    signature = Base64.encodeToString(signature, Base64.NO_WRAP)
                )
            } catch (e: Exception) {
                null
            }
        }
        
        private fun signEd25519(message: ByteArray, privateKey: ByteArray): ByteArray {
            // Use BouncyCastle or native Ed25519
            val keySpec = java.security.spec.PKCS8EncodedKeySpec(
                byteArrayOf(0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20) + privateKey
            )
            val keyFactory = KeyFactory.getInstance("Ed25519")
            val privKey = keyFactory.generatePrivate(keySpec)
            
            val sig = Signature.getInstance("Ed25519")
            sig.initSign(privKey)
            sig.update(message)
            return sig.sign()
        }
    }
}

data class AgentAuth(
    val mimeiId: String,
    val timestamp: Long,
    val signature: String
)
```

### 4. Add UI in Settings

```kotlin
// In your Settings Fragment/Activity
class SettingsFragment : Fragment() {
    private lateinit var agentTokenManager: AgentTokenManager
    
    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        agentTokenManager = AgentTokenManager(requireContext())
        
        binding.generateTokenButton.setOnClickListener {
            generateAndShowToken()
        }
    }
    
    private fun generateAndShowToken() {
        lifecycleScope.launch {
            try {
                val token = agentTokenManager.generateToken(currentUser.mid)
                
                // Save public key to server
                hproseService.updateAgentPublicKey(token.publicKey)
                
                // Show token to user
                val tokenString = token.export()
                showTokenDialog(tokenString)
                
            } catch (e: Exception) {
                Toast.makeText(context, "Failed: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }
    
    private fun showTokenDialog(tokenString: String) {
        AlertDialog.Builder(requireContext())
            .setTitle("Your Agent Token")
            .setMessage(tokenString)
            .setPositiveButton("Copy") { _, _ ->
                val clipboard = requireContext().getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("Agent Token", tokenString))
                Toast.makeText(context, "Copied!", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("Close", null)
            .show()
    }
}
```

### 5. Update User Model

```kotlin
// User.kt
data class User(
    val mid: String,
    val name: String?,
    val username: String?,
    // ... other fields ...
    val agentPublicKey: String? = null  // Add this field
)
```

### 6. Add HproseService Method

```kotlin
// HproseService.kt
suspend fun updateAgentPublicKey(publicKey: String): Boolean {
    val params = mapOf(
        "aid" to appId,
        "ver" to "last",
        "version" to "v2",
        "user" to JSONObject(mapOf(
            "mid" to currentUser.mid,
            "agentPublicKey" to publicKey
        )).toString()
    )
    
    val response = client.invoke("runMApp", arrayOf("set_author_core_data", params))
    // Handle response...
    return true
}
```

## AI Agent Client Example (Python)

Here's how an AI agent would use the token to post:

```python
import json
import base64
import time
import requests
from nacl.signing import SigningKey

def decode_token(token_string: str) -> dict:
    """Decode the agent token from base64"""
    json_bytes = base64.b64decode(token_string)
    return json.loads(json_bytes.decode('utf-8'))

def sign_request(data: dict, token: dict) -> dict:
    """Sign request data with the token's private key"""
    timestamp = int(time.time() * 1000)
    
    # Prepare data to sign
    signable = {**data, 'mimeiId': token['mimeiId'], 'timestamp': timestamp}
    sorted_data = dict(sorted(signable.items()))
    message = json.dumps(sorted_data, separators=(',', ':'))
    
    # Sign with Ed25519
    private_key_bytes = base64.b64decode(token['privateKey'])
    signing_key = SigningKey(private_key_bytes)
    signature = signing_key.sign(message.encode('utf-8')).signature
    
    return {
        'mimeiId': token['mimeiId'],
        'timestamp': timestamp,
        'signature': base64.b64encode(signature).decode('utf-8')
    }

def post_tweet_as_agent(server_url: str, token_string: str, content: str):
    """Post a tweet using agent authentication"""
    token = decode_token(token_string)
    
    tweet_data = {
        'authorId': token['mimeiId'],
        'content': content
    }
    
    agent_auth = sign_request(tweet_data, token)
    
    params = {
        'aid': 'd4lRyhABgqOnqY4bURSm_T-4FZ4',  # App ID
        'ver': 'last',
        'version': 'v2',
        'tweet': json.dumps(tweet_data),
        'agentAuth': agent_auth
    }
    
    # Make Hprose RPC call
    response = hprose_client.invoke('runMApp', ['add_tweet', params])
    return response

# Usage
TOKEN = "eyJ2ZXJzaW9uIjox..."  # User's agent token
post_tweet_as_agent("http://server:port", TOKEN, "Hello from AI agent!")
```

## Security Best Practices

1. **Token Storage**: Never store tokens in plain text. Use platform-specific secure storage (iOS Keychain, Android Keystore).

2. **Token Transmission**: Only share tokens through secure channels. Treat tokens like passwords.

3. **Token Rotation**: Encourage users to regenerate tokens periodically or after any suspected compromise.

4. **Scope Limiting**: Implement scope checking on the server to limit what agents can do.

5. **Audit Logging**: Log all agent-authenticated requests for security auditing.

6. **Rate Limiting**: Apply rate limits to agent requests to prevent abuse.

## Troubleshooting

### "Request expired" error
- Check that the AI agent's system clock is synchronized
- Ensure timestamp is in milliseconds, not seconds

### "Invalid signature" error
- Verify JSON serialization uses sorted keys and no whitespace
- Check that the same data fields are included in signing and verification
- Ensure Base64 encoding/decoding is consistent

### "Agent not configured" error
- User needs to generate a token in the app first
- Check that `agentPublicKey` was successfully saved to the server

## Version History

- **v1** (2025-02): Initial implementation with Ed25519 signatures
