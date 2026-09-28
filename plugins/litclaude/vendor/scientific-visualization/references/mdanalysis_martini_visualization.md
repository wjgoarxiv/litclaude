# MDAnalysis-based MARTINI / coarse-grained trajectory visualization

Use this reference when the user needs practical visualization of MARTINI or other coarse-grained MD trajectories, especially when VMD auto-bond rendering is awkward or water beads dominate the scene.

## Durable lesson

Coarse-grained MARTINI systems are often easier to visualize as particle clouds than as molecule/bond drawings:

- Hide water by default; otherwise tens of thousands of water beads obscure the morphology.
- Use `.gro` topology/coordinates with MDAnalysis when `.tpr` support is uncertain or too new for the installed MDAnalysis version.
- Treat the visualization as bead-class rendering: CP/oil beads, surfactant heads, surfactant tails, counterions, optional water.
- For morphology work, pair static PNG snapshots with an interactive HTML/WebGL or GUI viewer. Static images are good for reports; interactive orbit/slider is good for intuition.

## Recommended output pattern

For a trajectory visualization task, produce both:

1. Interactive HTML viewer
   - sampled frames embedded
   - slider/play controls
   - drag/orbit and wheel/zoom if possible
   - water hidden by default

2. PNG outputs
   - one last-frame PNG
   - optionally a sampled frame sequence directory
   - include frame/time annotation
   - label colors for each bead class

If the user asks casually to “just run/open/shoot it,” do the action: generate the artifact and open it locally when possible. Do not only print the command unless they ask for instructions.

## Minimal MDAnalysis bead-selection scaffold

```python
import MDAnalysis as mda
import numpy as np
import matplotlib.pyplot as plt
from style_presets import rcparams, style_legend

rcparams()

u = mda.Universe("eq_whole.gro", "traj.xtc")

# Common MARTINI CP/SDS labels from the CP-SDS emulsion project.
cp = u.select_atoms("resname CYP CYPE")
sds_head = u.select_atoms("resname SDS and name S1")
sds_tail = u.select_atoms("resname SDS and name C1 C2 C3")
na = u.select_atoms("resname NA or name NA")

u.trajectory[-1]
fig = plt.figure(figsize=(8, 7))
ax = fig.add_subplot(111, projection="3d")
for group, label, color, size in [
    (cp, "CP", "#18a999", 8),
    (sds_tail, "SDS tail", "#b8b8b8", 8),
    (sds_head, "SDS head", "#d62728", 18),
    (na, "Na+", "#8e44ad", 8),
]:
    if len(group):
        p = group.positions / 10.0  # MDAnalysis positions are Angstrom; plot nm.
        ax.scatter(p[:,0], p[:,1], p[:,2], s=size, c=color, label=label, alpha=0.85, edgecolors="none")
box = u.trajectory.ts.dimensions[:3] / 10.0
ax.set_xlim(0, box[0]); ax.set_ylim(0, box[1]); ax.set_zlim(0, box[2])
ax.set_xlabel("x (nm)"); ax.set_ylabel("y (nm)"); ax.set_zlabel("z (nm)")
ax.text2D(0.02, 0.96, f"frame {u.trajectory.frame}, t={u.trajectory.time/1000:.2f} ns", transform=ax.transAxes)
style_legend(ax, outside=True)
fig.savefig("mda_last.png", dpi=600, bbox_inches="tight", transparent=True)
```

## Practical tool ranking

- MDAnalysis: best for analysis-coupled visuals, automated PNGs, sampled frame sequences, and reproducible reports.
- OVITO: good GUI choice for bead/particle systems, slicing, particle radii, and quick visual exploration.
- VMD: still useful for MD trajectory handling, but MARTINI needs explicit representation setup because bonds may be absent and water beads dominate.

## Verification checklist

Before claiming completion:

- Run the script with the actual `.gro`/`.xtc` pair.
- Confirm output files exist and have nontrivial size.
- Open/check at least one PNG or browser-rendered HTML page.
- Verify water is hidden unless the user asked for water.
- Verify CP/SDS/head/tail/counterion colors and legend match the intended selections.
- If a PNG sequence is produced, count expected frame files and inspect first/last image dimensions.
