# Troubleshooting

## Printer shows as paused or disabled

If the printer appears paused in System Settings or `lpstat` shows it as disabled:

```bash
cupsenable Zebra_LP2844    # Enable the printer
cupsaccept Zebra_LP2844    # Accept jobs
lpstat -p Zebra_LP2844     # Verify status
```

## Print jobs are stuck in queue

```bash
cancel -a Zebra_LP2844     # Cancel all pending jobs
lpstat -o                  # Check queue is empty
```

## "Unable to send data to printer" error

This usually means the printer lost communication. Try:

1. Check USB cable is connected
2. Verify printer is powered on and shows a green ready light
3. Check the printer appears in USB devices:
   ```bash
   lpinfo -v | grep -i zebra
   ```
4. If the device URI is wrong or shows `/dev/null`, reconfigure:
   ```bash
   # Find the correct USB device
   lpinfo -v | grep -i zebra

   # Update the printer (use your serial number)
   sudo lpadmin -p Zebra_LP2844 -v "usb://Zebra/LP2844?serial=YOUR_SERIAL"

   # Re-enable
   cupsenable Zebra_LP2844
   cupsaccept Zebra_LP2844
   ```

## Web interface returns "Printer error" (502)

The app returns HTTP 502 when CUPS cannot communicate with the printer. Check:

1. Printer status: `lpstat -p Zebra_LP2844`
2. Recent CUPS errors: `tail -20 /var/log/cups/error_log`
3. Follow steps above to enable printer and clear stuck jobs

## Development without a printer

Use test mode to develop without a physical printer:

```bash
curl -X PUT -H "X-Dev-Password: dev" -H "Content-Type: application/json" \
  -d '{"test_mode": true}' http://localhost:8000/api/dev/settings
```

Or enable it through the web UI using the gear icon (Dev Settings) with password `dev`.
