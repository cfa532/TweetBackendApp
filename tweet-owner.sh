#!/usr/bin/env bash
# tweet-owner.sh — make someone an owner of this node, or set who may register.
#
# Run it on the node itself. Having a shell here is what makes a person an
# owner, so nothing else is asked of them: the script creates a Leither key,
# lists its user id in tweet.node.json beside the Leither executable, and
# prints the identity for the Tweet app to scan or import. The app signs in to
# this node with that key; the account is created on its first sign-in.
#
#   tweet-owner.sh [-w LEITHER_DIR] USERNAME          issue an owner identity
#   tweet-owner.sh [-w LEITHER_DIR] --guests allow    let guests register (default)
#   tweet-owner.sh [-w LEITHER_DIR] --guests deny     owners only
#   tweet-owner.sh [-w LEITHER_DIR] --list            show owners and the guest setting
#
# Run it once per owner; a node can have several. Importing one identity on a
# second device signs that device in as the same owner.
set -euo pipefail

usage() { sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

LEITHER_DIR="${TWEET_LEITHER_DIR:-}"
mode="issue"; username=""; guests=""
while (( $# )); do
  case "$1" in
    -w) LEITHER_DIR="${2:-}"; shift 2 ;;
    --guests) mode="guests"; guests="${2:-}"; shift 2 ;;
    --list) mode="list"; shift ;;
    -h|--help) usage 0 ;;
    -*) echo "Unknown option $1" >&2; usage 1 ;;
    *) username="$1"; shift ;;
  esac
done

if [[ -z "$LEITHER_DIR" ]]; then
  if [[ -x ./Leither ]]; then LEITHER_DIR=$(pwd)
  elif [[ -x "$(dirname "$0")/Leither" ]]; then LEITHER_DIR=$(cd "$(dirname "$0")" && pwd)
  else echo "Leither was not found here. Pass its directory with -w." >&2; exit 1; fi
fi
LEITHER_DIR=$(cd "$LEITHER_DIR" && pwd)
LEITHER_BIN="$LEITHER_DIR/Leither"
CONFIG="$LEITHER_DIR/tweet.node.json"
[[ -x "$LEITHER_BIN" ]] || { echo "No Leither executable in $LEITHER_DIR." >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required." >&2; exit 1; }

# One place reads and rewrites the configuration, so a half-written file is
# never left for the node to read.
update_config() {
  TWEET_CONFIG="$CONFIG" python3 - "$@" <<'PY'
import json, os, sys, time
path = os.environ["TWEET_CONFIG"]
config = {"version": 1, "allowGuestRegistration": True, "owners": {}}
if os.path.exists(path):
    with open(path) as handle:
        config.update(json.load(handle))
action = sys.argv[1]
if action == "guests":
    config["allowGuestRegistration"] = sys.argv[2] == "allow"
elif action == "owner":
    uid, username = sys.argv[2], sys.argv[3]
    for other, record in config["owners"].items():
        if record.get("username", "").lower() == username.lower():
            # A second identity for the same account replaces the first: the
            # account is controlled by one identity at a time.
            print(f"Note: {username} was paired as {other}; that identity stops working once the new one signs in.", file=sys.stderr)
    config["owners"] = {u: r for u, r in config["owners"].items() if r.get("username", "").lower() != username.lower()}
    config["owners"][uid] = {"username": username, "createdAt": int(time.time() * 1000)}
elif action == "list":
    print("Guest registration:", "allowed" if config["allowGuestRegistration"] else "denied")
    for uid, record in config["owners"].items():
        print(f"Owner {record.get('username')}  {uid}")
    if not config["owners"]:
        print("No owners yet.")
    sys.exit(0)
temporary = path + ".tmp"
with open(temporary, "w") as handle:
    json.dump(config, handle, indent=2)
    handle.write("\n")
os.chmod(temporary, 0o644)
os.replace(temporary, path)
PY
}

case "$mode" in
  list) update_config list; exit 0 ;;
  guests)
    [[ "$guests" == allow || "$guests" == deny ]] || { echo "Use --guests allow or --guests deny." >&2; exit 1; }
    update_config guests "$guests"
    if [[ "$guests" == allow ]]; then echo "Guests may register on this node."
    else echo "Guest registration on this node is now denied; only owners can sign in."; fi
    exit 0 ;;
esac

# The same rule the node applies to a username.
if [[ ! "$username" =~ ^[A-Za-z0-9_-]{1,20}$ ]]; then
  echo "Give a username of 1-20 letters, digits, '_' or '-'." >&2
  usage 1
fi

node_id=$("$LEITHER_BIN" swarm id -w "$LEITHER_DIR" 2>/dev/null | sed -n '1p' | tr -d '[:space:]')
if [[ ! "$node_id" =~ ^[A-Za-z0-9_-]{27}$ ]]; then
  echo "This node did not report its own id ('$LEITHER_BIN swarm id')." >&2
  exit 1
fi

umask 077
work=$(mktemp -d "$LEITHER_DIR/.tweet-owner.XXXXXX")
trap 'rm -rf -- "$work"' EXIT

"$LEITHER_BIN" lpki genkey -o "$work/owner.key" >/dev/null
"$LEITHER_BIN" lpki gencert -k "$work/owner.key" -m "name=$username" -o "$work/owner.ca" >/dev/null
"$LEITHER_BIN" lpki signppt -c "$work/owner.ca" -p 15 -m "CertFor=Self" -o "$work/login.ppt" >/dev/null
"$LEITHER_BIN" lpki verifyppt -c "$work/owner.ca" -i "$work/login.ppt" >/dev/null

identity="$LEITHER_DIR/tweet-owner-$username-$(date -u +%Y%m%dT%H%M%SZ).identity.json"

# Writes the identity file and prints "<uid>\n<compact QR text>".
#
# The certificate inside a passport (signer_info) is a ~770 character Go gob
# that repeats the user id and public key around constant type metadata, which
# makes a QR of the whole identity too dense to scan off a terminal. Only its
# signature and name are unique, so the QR carries those and the app rebuilds
# the same bytes. build_signer_info must stay identical to OwnerIdentity in the
# apps (it is the layout LifeDrive's installer and apps already share).
result=$(TWEET_KEY="$work/owner.key" TWEET_PPT="$work/login.ppt" TWEET_OUT="$identity" \
         TWEET_NODE="$node_id" TWEET_USERNAME="$username" python3 - <<'PY'
import base64, json, os, re, sys, time

def b64url(data): return base64.urlsafe_b64encode(data).decode().rstrip("=")
def fail(message):
    print(f"Owner setup stopped: {message}", file=sys.stderr); sys.exit(1)

# Leither writes the key file as two concatenated JSON documents: a key-type
# line, then {"Sk","Pk"} in standard base64.
pair = None
for line in open(os.environ["TWEET_KEY"]):
    line = line.strip()
    if line.startswith("{"):
        try: parsed = json.loads(line)
        except ValueError: continue
        if isinstance(parsed.get("Sk"), str) and isinstance(parsed.get("Pk"), str):
            pair = parsed; break
if pair is None: fail("Leither produced an unreadable key file.")
secret, public = base64.b64decode(pair["Sk"]), base64.b64decode(pair["Pk"])
ppt = json.loads(open(os.environ["TWEET_PPT"]).read().strip())
uid, signer_info = ppt.get("SignerID", ""), ppt.get("SignerInfo", "")
if len(secret) != 64 or len(public) != 32 or secret[32:] != public or ppt.get("KeyType") != "sodiumv2" \
        or not re.fullmatch(r"[A-Za-z0-9_-]{27}", uid) or not signer_info:
    fail("Leither produced an unsupported identity (expected sodiumv2).")

PREFIX = bytes.fromhex("307f030101085369676e496e666f01ff80000102010c426173655369676e496e666f01ff8200010444617461010c0000002eff810301010c426173655369676e496e666f01ff82000101010e426173655369676e496e666f563101ff8400000065ff830301010e426173655369676e496e666f563101ff8400010601095369676e6174757265010a0001085369676e65724944010c00010a5369676e6572496e666f010a0001074b657954797065010c00010756657273696f6e0106000102504b010a000000")
KEY_PREFIX = bytes.fromhex("0b0c0008736f6469756d76322f7f0301010f536f6469756d4b657950616972563201ff80000101010d536f6469756d4b65795061697201ff8200000029ff810301010d536f6469756d4b65795061697201ff820001020102536b010a000102506b010a00000027ff80010220")
BODY_HEAD = bytes.fromhex("ff8001010140")
AFTER_ID = bytes.fromhex("0208") + b"sodiumv2" + bytes.fromhex("0101000001")

def gob_uint(value):
    if value < 128: return bytes([value])
    digits = value.to_bytes((value.bit_length() + 7) // 8, "big")
    return bytes([256 - len(digits)]) + digits

def build_signer_info(signature, uid, public, name):
    key_blob = KEY_PREFIX + public + b"\x00\x00"
    certificate = f"CertPK={b64url(key_blob)}==;CertPKID={uid};name={name};".encode()
    body = BODY_HEAD + signature + bytes([1, 27]) + uid.encode() + AFTER_ID + gob_uint(len(certificate)) + certificate + b"\x00"
    return base64.b64encode(PREFIX + gob_uint(len(body)) + body).decode()

raw = base64.b64decode(signer_info)
start = len(PREFIX) + 3
signature = raw[start + 6:start + 70]
name = os.environ["TWEET_USERNAME"]
compact = None
if build_signer_info(signature, uid, public, name) == signer_info:
    compact = {"t": "twq", "n": os.environ["TWEET_NODE"], "u": uid, "o": name,
               "s": b64url(secret[:32]), "g": b64url(signature)}

bundle = {"type": "tweet-owner-identity", "version": 1, "node_id": os.environ["TWEET_NODE"], "uid": uid,
          "username": name, "key_type": "sodiumv2", "public_key": b64url(public), "private_key": b64url(secret[:32]),
          "signer_info": signer_info, "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
descriptor = os.open(os.environ["TWEET_OUT"], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(descriptor, "w") as handle:
    json.dump(bundle, handle, indent=2); handle.write("\n")
print(uid)
print(json.dumps(compact, separators=(",", ":")) if compact else "")
PY
)
uid=$(sed -n '1p' <<<"$result")
compact=$(sed -n '2p' <<<"$result")

update_config owner "$uid" "$username"

echo "Owner '$username' is paired to this node as $uid."
echo "Identity file: $identity"
echo
if [[ -n "$compact" ]] && command -v qrencode >/dev/null; then
  echo "In the Tweet app choose Sign in > Pair with my node, and scan:"
  echo
  qrencode -t ANSIUTF8 -m 2 "$compact"
  echo
elif [[ -n "$compact" ]]; then
  echo "Install 'qrencode' to show a QR code here. Without it, in the Tweet app choose"
  echo "Sign in > Pair with my node > Paste, and paste this line:"
  echo
  echo "$compact"
  echo
fi
echo "You can also import the identity file in the app instead of scanning."
echo
echo "The code and the file hold this owner's private key. Anyone who reads them"
echo "can act as '$username', so clear the terminal afterwards and keep the file"
echo "somewhere safe as the way to pair a replacement device."
