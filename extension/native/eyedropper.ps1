# Selection Colors - eyedropper launcher (Windows PowerShell 5.1)
# Protocol on stdout:  R = overlay ready | M RRGGBB = hover | P RRGGBB = picked | C = cancelled | E msg = error
$ErrorActionPreference = 'Stop'
function Out-Line([string]$s) { [Console]::Out.WriteLine($s); [Console]::Out.Flush() }

try {
    $src  = Join-Path $PSScriptRoot 'Eyedropper.cs'
    $code = [IO.File]::ReadAllText($src)
    $sha  = [Security.Cryptography.SHA256]::Create()
    $hash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($code))) -replace '-', '').Substring(0, 12)
    $dll  = Join-Path ([IO.Path]::GetTempPath()) ('SelectionColors_Eyedropper_' + $hash + '.dll')
    $refs = @('System.Windows.Forms', 'System.Drawing')

    if (-not ('SCEye.Picker' -as [type])) {
        $loaded = $false
        if (Test-Path -LiteralPath $dll) {
            try { Add-Type -LiteralPath $dll; $loaded = $true } catch { $loaded = $false }
        }
        if (-not $loaded) {
            try {
                # Compile once to %TEMP% so later launches start fast.
                Add-Type -TypeDefinition $code -ReferencedAssemblies $refs -OutputAssembly $dll -OutputType Library
                if (-not ('SCEye.Picker' -as [type])) { Add-Type -LiteralPath $dll }
            } catch {
                # Temp not writable/loadable: compile in memory instead.
                if (-not ('SCEye.Picker' -as [type])) { Add-Type -TypeDefinition $code -ReferencedAssemblies $refs }
            }
        }
    }

    Out-Line 'R'
    $hex = [SCEye.Picker]::Run()
    if ($hex) { Out-Line ('P ' + $hex) } else { Out-Line 'C' }
}
catch {
    Out-Line ('E ' + ($_.Exception.Message -replace '[\r\n]+', ' '))
}
