/** Made-up test input: two four-taxon trees with a TRANSLATE table and a TAXA block the reader skips. */
export const NEXUS = `#NEXUS
BEGIN TAXA;
  DIMENSIONS NTAX=4;
END;
BEGIN TREES;
  TRANSLATE 1 Alpha, 2 Beta, 3 Gamma, 4 Delta;
  TREE one = [&R] ((1:1,2:1)90:1,(3:1,4:1)80:1);
  TREE two = [&R] ((1:1,3:1)70:1,(2:1,4:1)60:1);
END;
`
