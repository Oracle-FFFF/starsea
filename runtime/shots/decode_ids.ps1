Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Bitmap]::FromFile("F:\Thegalaxy\starsea\runtime\shots\apitest.png")
$rows = @{ A = 146; B = 193; C = 241 }
$X0 = 905
$X1 = 1345
foreach ($k in @('A','B','C')) {
  $y0 = $rows[$k]
  $y1 = $y0 + 29
  $ink = New-Object 'System.Collections.Generic.List[int]'
  for ($x = $X0; $x -le $X1; $x++) {
    $c = 0
    for ($y = $y0; $y -le $y1; $y++) { if ($src.GetPixel($x, $y).R -gt 100) { $c++ } }
    $ink.Add($c)
  }
  $starts = New-Object 'System.Collections.Generic.List[int]'
  $ends = New-Object 'System.Collections.Generic.List[int]'
  $s = -1
  for ($i = 0; $i -lt $ink.Count; $i++) {
    if ($ink[$i] -gt 0) { if ($s -lt 0) { $s = $i } }
    else { if ($s -ge 0) { $starts.Add($s); $ends.Add($i - 1); $s = -1 } }
  }
  if ($s -ge 0) { $starts.Add($s); $ends.Add($ink.Count - 1) }
  Write-Output "=== ROW $k : $($starts.Count) glyph runs, x = 905+index ==="
  $info = @()
  for ($j = 0; $j -lt $starts.Count; $j++) {
    $info += ("$($X0 + $starts[$j])-" + "$($X0 + $ends[$j])")
  }
  Write-Output ("runs: " + ($info -join ' '))
  $buf = New-Object 'System.Collections.Generic.List[object]'
  for ($j = 0; $j -lt $starts.Count; $j++) {
    $lines = @()
    for ($y = $y0 + 9; $y -le $y0 + 22; $y++) {
      $ln = ''
      for ($x = ($X0 + $starts[$j]); $x -le ($X0 + $ends[$j]); $x++) {
        if ($src.GetPixel($x, $y).R -gt 120) { $ln += '#' } else { $ln += '.' }
      }
      $lines += $ln
    }
    $buf.Add(@{ i = $j; L = $lines; w = ($ends[$j] - $starts[$j] + 1) })
    if ($buf.Count -eq 14 -or $j -eq ($starts.Count - 1)) {
      for ($r = 0; $r -lt 14; $r++) {
        $out = ''
        foreach ($g in $buf) { $out += $g.L[$r].PadRight(6, '.') }
        Write-Output $out
      }
      Write-Output ("#: " + (($buf | ForEach-Object { "$($_.i)w$($_.w)" }) -join ' '))
      $buf.Clear()
    }
  }
}
$src.Dispose()
