/**
 * One wording for deleting employees — the profile's Delete and the
 * roster's bulk Delete say exactly the same thing.
 */
export function DeleteEmployeeCopy({ who }: { who: string }) {
  return (
    <>
      This removes {who} from every screen — profile, punches, schedule and
      payroll history. A full snapshot is saved to the activity log first, but
      it can&apos;t be restored from the app. If someone just left, use{" "}
      <span className="font-medium text-foreground">Deactivate</span> in Edit
      employee instead; it keeps everything.
    </>
  );
}
