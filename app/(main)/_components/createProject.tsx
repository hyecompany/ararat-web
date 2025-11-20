"use client";

// Component for creating new Incus projects
import { Button } from "@/app/_components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/app/_components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/app/_components/ui/form";
import { Input } from "@/app/_components/ui/input";
import { useState, use } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import z from "zod";
import { createProject } from "@/app/(main)/_lib/projects";
import { mutate } from "swr";
import { toast } from "sonner";
import { PlusIcon } from "lucide-react";
import { Textarea } from "@/app/_components/textarea";
import { useConfigurableOptions } from "@/app/_hooks/server";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/app/_components/ui/accordion";
import ProjectsContext from "@/app/(main)/_context/projects";

const formSchema = z.object({
  name: z
    .string()
    .min(1, "Project name is required")
    .max(63, "Project name must be at most 63 characters long")
    .regex(
      /^[a-z][a-z0-9-]*[a-z0-9]$/,
      "Project name must start with a lowercase letter and can only contain lowercase letters, numbers, and dashes. It cannot end with a dash."
    ),
  description: z.string().optional(),
  config: z.record(z.string()).optional(),
});

interface ProjectConfigField {
  key: string;
  type: string;
  description?: string;
  defaultValue?: string;
}

interface ConfigOptionValue {
  type?: string;
  longdesc?: string;
  shortdesc?: string;
  default?: string;
}

export default function CreateProject() {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { data: configurableOptions } = useConfigurableOptions();
  const { setProject } = use(ProjectsContext);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      config: {},
    },
  });

  const projectConfigFields: ProjectConfigField[] = configurableOptions?.configs
    ?.project
    ? Object.entries(
        configurableOptions.configs.project as Record<string, ConfigOptionValue>
      ).map(([key, value]) => ({
        key,
        type: value.type || "string",
        description: value.longdesc || value.shortdesc || "",
        defaultValue: value.default || "",
      }))
    : [];

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      setIsSubmitting(true);

      // Filter out empty config values
      const config = Object.entries(values.config || {}).reduce(
        (acc, [key, value]) => {
          if (value && value.trim() !== "") {
            acc[key] = value;
          }
          return acc;
        },
        {} as Record<string, string>
      );

      await createProject({
        name: values.name,
        description: values.description,
        config: Object.keys(config).length > 0 ? config : undefined,
      });

      // Invalidate the projects cache to refresh the list
      await mutate("/1.0/projects?recursion=1");

      // Set the newly created project as the current project
      setProject(values.name);

      toast.success("Project created successfully", {
        description: `Project "${values.name}" has been created.`,
      });

      setOpen(false);
      form.reset();
    } catch (error) {
      console.error("Failed to create project:", error);
      toast.error("Failed to create project", {
        description:
          error instanceof Error ? error.message : "An unknown error occurred",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="size-6">
          <PlusIcon className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
          <DialogDescription>
            Create a new project with optional configuration
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="my-project"
                      {...field}
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormDescription>
                    The name must start with a lowercase letter and contain only
                    lowercase letters, numbers, and dashes.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Project description"
                      {...field}
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {projectConfigFields.length > 0 && (
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="config">
                  <AccordionTrigger>
                    Advanced Configuration (Optional)
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-4 pt-4">
                      {projectConfigFields.slice(0, 10).map((field) => (
                        <FormField
                          key={field.key}
                          control={form.control}
                          name={`config.${field.key}`}
                          render={({ field: formField }) => (
                            <FormItem>
                              <FormLabel className="text-xs">
                                {field.key}
                              </FormLabel>
                              <FormControl>
                                <Input
                                  placeholder={field.defaultValue || ""}
                                  {...formField}
                                  disabled={isSubmitting}
                                />
                              </FormControl>
                              {field.description && (
                                <FormDescription className="text-xs">
                                  {field.description}
                                </FormDescription>
                              )}
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Creating..." : "Create Project"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
