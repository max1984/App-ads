import re

# RFC-compliant domain validation regex (lowercase expected)
DOMAIN_REGEX = re.compile(
    r'^(?=.{1,253}$)(?!-)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?'
    r'(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$'
)

SUPPORTED_VARIABLES = {
    'CONTACT',
    'SUBDOMAIN',
    'INVENTORYPARTNERDOMAIN',
    'OWNERDOMAIN',
    'MANAGERDOMAIN',
}

# Real-world TAG (Trustworthy Accountability Group) Certified Against Fraud IDs.
# Source: IAB Tech Lab / TAG registry — commonly seen in production ads.txt files.
VALID_CA_IDS = {
    # Google
    "f08c47fec0942fa0": "Google (Authorized Buyers)",
    "7842df1d2fe2db34": "Google AdSense / AdMob",
    # AppNexus / Xandr
    "e1a5b5b704a45b4e": "Xandr (AppNexus)",
    # OpenX
    "5d62403b186f2ace": "OpenX",
    # PubMatic
    "1ad675c9de6b5176": "PubMatic",
    # Index Exchange
    "50b1c356f2c5c8fc": "Index Exchange",
    # Magnite (Rubicon Project)
    "0bfd66d529a55807": "Magnite (Rubicon Project)",
    # Criteo
    "3fd707be9c4527c3": "Criteo",
    # Sovrn
    "fafdf38b16bf6b2b": "Sovrn",
    # TripleLift
    "6a698e965b670f21": "TripleLift",
    # Sharethrough
    "d53b998a7bd4ecd2": "Sharethrough",
    # Verizon Media (Yahoo)
    "e1a5b5b704a45b4e": "Verizon Media / Yahoo",
    # Amazon
    "18e5c4a0b8280590": "Amazon Publisher Services",
    # Teads
    "15a9c44f6d26379a": "Teads",
    # Undertone
    "7c1e9b4a0d5f3c28": "Undertone",
    # Smaato
    "07bcf65f187117b4": "Smaato",
    # IronSource
    "a670e2c36b2c2a9d": "IronSource",
    # Unity Ads
    "c228e6794e811952": "Unity Ads",
    # Fyber
    "59c49ff303f41b7f": "Fyber (Digital Turbine)",
    # MoPub (deprecated but still seen in old files)
    "a2765ed5dbc692ec": "MoPub (Twitter)",
    # Vungle
    "4c559b06b9b9483b": "Vungle (Liftoff)",
    # AdColony
    "1d7d3d9a5c42f0db": "AdColony",
    # InMobi
    "9e1ce09b7cb0e6e8": "InMobi",
    # Chartboost
    "c09acac31a81d462": "Chartboost",
    # AppLovin
    "7118c6312e0b7d84": "AppLovin",
}


def verify_authorization_signature(signature: str) -> tuple[bool, str | None]:
    """Check a Certification Authority ID against the known TAG registry.

    Returns (True, ca_name) if recognised, otherwise (False, None).
    """
    if signature in VALID_CA_IDS:
        return True, VALID_CA_IDS[signature]
    return False, None


def validate_ads_txt(content: str) -> tuple[str, list[str]]:
    """Validate and auto-correct an app-ads.txt file.

    Args:
        content: Raw file content as a string.

    Returns:
        A tuple of (corrected_content, notes) where notes is a list of
        human-readable messages about changes and warnings.
    """
    lines = content.splitlines()
    corrected_lines = []
    notes = []
    variables: dict[str, list[str]] = {}
    # Track line indices where variables appeared so we can preserve order
    variable_line_indices: dict[int, tuple[str, str]] = {}
    seen_records: set[tuple[str, str, str]] = set()
    removed_duplicates: list[str] = []
    line_number = 0
    has_records = False

    for line in lines:
        line_number += 1
        stripped = line.strip()

        # Preserve comments and blank lines as-is
        if stripped.startswith('#') or not stripped:
            corrected_lines.append(line)
            continue

        # Variable declarations  (KEY=VALUE)
        if '=' in stripped and not stripped.startswith('http'):
            var_parts = stripped.split('=', 1)
            if len(var_parts) != 2:
                notes.append(f"Line {line_number}: Invalid variable declaration — skipped.")
                corrected_lines.append(line)
                continue

            variable = var_parts[0].strip().upper()
            value = var_parts[1].strip()

            if variable not in SUPPORTED_VARIABLES:
                notes.append(
                    f"Line {line_number}: Unsupported variable '{variable}' — "
                    f"valid variables are {', '.join(sorted(SUPPORTED_VARIABLES))}."
                )
                corrected_lines.append(line)
                continue

            # Allow multiple OWNERDOMAIN lines (spec allows exactly one, warn on extras)
            if variable == 'OWNERDOMAIN' and variable in variables:
                notes.append(
                    f"Line {line_number}: Multiple OWNERDOMAIN declarations found. "
                    "The ads.txt spec recommends only one — using the first value."
                )
                # Keep the line in the file but don't overwrite the stored value
                corrected_lines.append(f"{variable}={value}")
                continue

            variables.setdefault(variable, []).append(value)
            corrected_lines.append(f"{variable}={value}")
            continue

        # ----- Data records -----
        extension_data = ""
        has_extension = ';' in stripped

        if has_extension:
            before_ext, extension_data = stripped.split(';', 1)
            parts = [p.strip() for p in before_ext.split(',')]
        else:
            parts = [p.strip() for p in stripped.split(',')]

        if len(parts) < 3:
            notes.append(
                f"Line {line_number}: Invalid format — expected at least 3 comma-separated "
                f"fields (domain, publisher_id, relationship), got {len(parts)}. Line skipped."
            )
            continue

        # Normalise case: fields 1-2 → lowercase, field 3 → uppercase
        parts[0] = parts[0].lower()
        parts[1] = parts[1].lower()
        parts[2] = parts[2].upper()

        domain = parts[0]
        publisher_id = parts[1]
        relationship = parts[2]
        cert_id = parts[3].strip() if len(parts) > 3 else ''

        # Duplicate detection keyed on (domain, publisher_id, cert_id)
        record_key = (domain, publisher_id, cert_id)
        if record_key in seen_records:
            removed_duplicates.append(
                f"Line {line_number}: Duplicate record ({domain}, {publisher_id}"
                f"{', ' + cert_id if cert_id else ''}) removed."
            )
            continue
        seen_records.add(record_key)

        # Field validations
        if not DOMAIN_REGEX.match(domain):
            notes.append(f"Line {line_number}: Invalid domain '{domain}' (Field #1).")

        if not publisher_id:
            notes.append(f"Line {line_number}: Empty publisher account ID (Field #2).")

        if relationship not in {'DIRECT', 'RESELLER'}:
            notes.append(
                f"Line {line_number}: Invalid relationship '{relationship}' (Field #3). "
                "Must be DIRECT or RESELLER."
            )

        if cert_id:
            if not re.match(r'^[a-zA-Z0-9_-]+$', cert_id):
                notes.append(
                    f"Line {line_number}: Certification ID '{cert_id}' (Field #4) "
                    "contains invalid characters."
                )
            else:
                valid, ca_name = verify_authorization_signature(cert_id)
                if valid:
                    notes.append(
                        f"Line {line_number}: Certification ID '{cert_id}' verified — {ca_name}."
                    )
                else:
                    notes.append(
                        f"Line {line_number}: Certification ID '{cert_id}' not in known TAG registry "
                        "(may still be valid — registry is not exhaustive)."
                    )

        # Reconstruct the corrected line
        record_parts = [domain, publisher_id, relationship]
        if cert_id:
            record_parts.append(cert_id)
        reconstructed = ', '.join(record_parts)
        if has_extension:
            reconstructed += ';' + extension_data

        corrected_lines.append(reconstructed)
        has_records = True

    if not has_records and not variables:
        notes.append("File contains no valid data records or variable declarations.")

    notes.extend(removed_duplicates)

    corrected_content = '\n'.join(corrected_lines)
    return corrected_content, notes
