# Self-Signed Code-Signing Cert (Wave 1)

This is the **dev/early-user signing flow**. Replace with an EV cert ($200/yr) once
downloads cross 100+ to skip SmartScreen entirely.

## Generate the cert (Windows PowerShell, one-time)

```powershell
$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject "CN=Radix Media, O=Radix Media, C=AE" `
  -KeyUsage DigitalSignature `
  -KeySpec Signature `
  -CertStoreLocation Cert:\CurrentUser\My `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -NotAfter (Get-Date).AddYears(3)

$pwd = ConvertTo-SecureString -String "PICK_A_STRONG_PASSWORD" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath "apps\desktop\build\cert.pfx" -Password $pwd
```

## Set the password env

In your dev shell before `pnpm electron:build`:

```powershell
$env:CSC_KEY_PASSWORD = "PICK_A_STRONG_PASSWORD"
```

(Or persist via `setx CSC_KEY_PASSWORD "..."` for a permanent setting.)

## .gitignore

`build/cert.pfx` MUST be in `.gitignore`. Never commit the cert. The password
lives only in the developer's shell env or in CI secrets (when we add CI).

## Trusting the cert on user machines (optional, kills SmartScreen)

Distribute the public certificate (`.cer`) once and have users import it into
"Trusted Publishers". Most teams skip this and live with the SmartScreen prompt.
